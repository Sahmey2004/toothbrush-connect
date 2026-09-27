// Messaging agent: drains the database's outbox (`outbound_messages`) and sends each message through Photon,
// and answers texts and tapbacks coming back. The website feed is delivered by the database separately; a
// failure here never affects it.
import { setTimeout as sleep } from "node:timers/promises";
import { loadAgentConfig, type AgentConfig } from "./config.js";
import { createInboundHandler } from "./inbound/handler.js";
import type { ContactDirectory, ContactRegistry, Inbox, LinkBuilder, Outbox, OutboxMessage, SendReport } from "./ports.js";
import { connectIMessage, createIMessageProvider } from "./providers/imessage.js";
import { createPhotonUsers, noContactRegistry } from "./providers/photon-users.js";
import { createTerminalProvider } from "./providers/terminal.js";
import type { MessagingProvider } from "./providers/types.js";
import { renderUpdate, renderWelcome } from "./templates/messages.js";

export type * from "./ports.js";

export interface AgentDeps {
  provider: MessagingProvider;
  outbox: Outbox;
  inbox: Inbox;
  links: LinkBuilder;
  // Photon only talks to numbers on the project's Users list; every known phone is added to it.
  contacts?: { directory: ContactDirectory; registry: ContactRegistry };
  log?: (line: string) => void;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Photon's send has no timeout of its own. A message that isn't out within this (registering the phone, looking up
// the check-in, sending) counts as a failed send and is retried later.
const SEND_TIMEOUT_MS = 30_000;
const SEND_TIMED_OUT = `not sent within ${SEND_TIMEOUT_MS / 1000} s`;
// Per complete_outbound try: a one-row update, normally answered in well under a second. A slow try still lands,
// and the retry is then a no-op.
const COMPLETE_TIMEOUT_MS = 3_000;

// Rejects if `work` hasn't settled within `ms`. The work itself carries on.
function withTimeout<T>(work: Promise<T>, ms: number, error: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(error)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createAgent({ provider, outbox, inbox, links, contacts, log = console.log }: AgentDeps) {
  const handleInbound = createInboundHandler({ provider, links, inbox });
  // Check-ins and the welcome are rendered with our templates and brushing-now gets its Join link (FR-D3: label
  // first, link last); other kinds go out as the database wrote them.
  async function textFor(m: OutboxMessage): Promise<string> {
    switch (m.kind) {
      case "check_in": {
        const checkIn = m.checkInId ? await outbox.getCheckIn(m.checkInId, m.userId) : null;
        return checkIn ? renderUpdate(checkIn, links.checkIn(checkIn.id, m.userId)) : m.body;
      }
      // Queued once per person and number by the database when a number is verified without texting us
      // (migration 0010). It starts the thread on their Photon line, so they never need to know which number
      // to text.
      case "welcome":
        return renderWelcome(links.page("/timeline"));
      case "presence":
      case "presence_proactive":
        return `${m.body} Join → ${links.page("/brush")}`;
      default:
        return m.body;
    }
  }

  async function register(phone: string, name?: string | null): Promise<void> {
    if (!contacts) return;
    try {
      if (await contacts.registry.ensure(phone, name)) log(`registered ${phone} with Photon`);
    } catch (e) {
      log(`registering ${phone} with Photon failed: ${errorText(e)}`);
    }
  }

  // Add every phone in the database to Photon's Users, e.g. right after someone signs up or is invited. This
  // never texts anyone: welcomes and invites come through the outbox.
  async function syncContacts() {
    if (!contacts) return;
    for (const c of await contacts.directory.listPhones()) await register(c.phone, c.name);
  }

  async function sendOne(m: OutboxMessage): Promise<SendReport> {
    if (m.channel !== provider.channel) return { ok: false, error: `no ${m.channel} provider` };
    let gaveUp = false;
    const sending = (async () => {
      await register(m.address); // a brand-new invitee may not be synced yet
      const text = await textFor(m);
      if (gaveUp) throw new Error("gave up"); // already reported as failed: the retry sends it
      return provider.send(m.address, text, { effect: m.effect });
    })();
    try {
      const { providerMessageId } = await withTimeout(sending, SEND_TIMEOUT_MS, SEND_TIMED_OUT);
      return { ok: true, providerMessageId };
    } catch (e) {
      gaveUp = true;
      // A send that timed out may still get through. Recording that (0008 takes a success on a released message)
      // stops the retry, unless the retry has already gone out.
      sending.then(
        ({ providerMessageId }) =>
          record(m.id, { ok: true, providerMessageId }).then(
            () => log(`sent #${m.id} after all`),
            (e) => log(`recording #${m.id} failed: ${errorText(e)}`),
          ),
        () => {}, // failed after all, as reported
      );
      return { ok: false, error: errorText(e) };
    }
  }

  // complete_outbound, tried 3 times: after one blip the message would stay 'sending' until its claim lapses and
  // then go out again. Repeating is safe (0008 records a success once, and a failure only while the message is
  // out), and every try is over long before the 30 s a failed message waits for its retry.
  async function record(id: number, report: SendReport): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await withTimeout(outbox.complete(id, report), COMPLETE_TIMEOUT_MS, "complete_outbound timed out");
      } catch (e) {
        if (attempt === 3) throw e;
        await pause(500 * attempt);
      }
    }
  }

  // Send everything that's due, one message at a time, to stay well inside Photon's rate limits. A claim is a
  // 10-minute lease (migration 0008): after that another agent may take the rest of the batch and text it again.
  // So a batch is 10 messages, each done within 30 s plus at most 10.5 s to record it (3 tries of 3 s, 0.5 s and
  // 1 s apart): under 7 minutes even if every call times out, 5 if only Photon hangs, and normally 10–30 s.
  // Polling every 2 s, the small batch costs no real throughput.
  async function drain(limit = 10): Promise<{ message: OutboxMessage; report: SendReport }[]> {
    const results = [];
    for (const message of await outbox.claim(limit)) {
      const report = await sendOne(message);
      // Move on: waiting here would hold up the rest of the batch while its lease runs down.
      await record(message.id, report).catch((e) => log(`recording #${message.id} failed: ${errorText(e)}`));
      log(`${report.ok ? "sent" : "failed"} #${message.id} ${message.kind} → ${message.address}${report.ok ? "" : `: ${report.error}`}`);
      results.push({ message, report });
    }
    return results;
  }

  return {
    drain,
    syncContacts,

    // Poll the outbox until `signal` aborts (the database's cron delivers held check-ins every 5 s), and sync
    // contacts with Photon every `syncEveryMs`. `sendOutbox: false` leaves the outbox alone.
    async run({
      intervalMs = 2000,
      syncEveryMs = 5_000,
      sendOutbox = true,
      signal,
    }: { intervalMs?: number; syncEveryMs?: number; sendOutbox?: boolean; signal?: AbortSignal } = {}) {
      let lastSync = -Infinity;
      while (!signal?.aborted) {
        if (Date.now() - lastSync >= syncEveryMs) {
          lastSync = Date.now();
          await syncContacts().catch((e) => log(`contact sync failed: ${errorText(e)}`));
        }
        try {
          if (sendOutbox) await drain();
        } catch (e) {
          log(`outbox poll failed: ${errorText(e)}`);
        }
        await sleep(intervalMs, undefined, { signal }).catch(() => {});
      }
    },

    // Answer inbound texts and tapbacks until the provider stops.
    async listen() {
      const seen = new Set<string>(); // the stream may repeat events after a reconnect
      for await (const event of provider.inbound()) {
        if (seen.has(event.messageId)) continue;
        seen.add(event.messageId);
        if (seen.size > 1000) seen.delete(seen.values().next().value!);
        try {
          const reply = await handleInbound(event);
          log(`inbound ${event.type} from ${event.from}${reply ? ` → replied ${reply.split(" ", 3).join(" ")}` : ""}`);
        } catch (e) {
          log(`inbound from ${event.from} failed: ${errorText(e)}`);
        }
      }
    },

    stop: () => provider.stop(),
  };
}

export type Agent = ReturnType<typeof createAgent>;

// The provider AGENT_MODE asks for: Photon iMessage, or printing to the terminal.
export async function createProvider(config: AgentConfig = loadAgentConfig()): Promise<MessagingProvider> {
  return config.mode === "photon" ? createIMessageProvider(await connectIMessage(config.photon)) : createTerminalProvider();
}

// Photon's Users list in photon mode; nothing to register in terminal mode.
export function createContactRegistry(config: AgentConfig = loadAgentConfig()): ContactRegistry {
  return config.mode === "photon" ? createPhotonUsers(config.photon) : noContactRegistry;
}
