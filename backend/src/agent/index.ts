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

export function createAgent({ provider, outbox, inbox, links, contacts, log = console.log }: AgentDeps) {
  // A number that just verified by texting has had its ✅ CONNECTED reply, and texting the line put it on
  // Photon's Users. Registering it here means the next contact sync doesn't welcome it a second time.
  const handleInbound = createInboundHandler({
    provider,
    links,
    inbox: {
      async handle(msg) {
        const result = await inbox.handle(msg);
        if (result.action === "verified") await register(msg.from, result.displayName);
        return result;
      },
    },
  });
  // Check-ins are re-rendered with our templates and brushing-now gets its Join link (FR-D3: label first, link
  // last); other kinds go out as the database wrote them.
  async function textFor(m: OutboxMessage): Promise<string> {
    switch (m.kind) {
      case "check_in": {
        const checkIn = m.checkInId ? await outbox.getCheckIn(m.checkInId, m.userId) : null;
        return checkIn ? renderUpdate(checkIn, links.checkIn(checkIn.id, m.userId)) : m.body;
      }
      case "presence":
      case "presence_proactive":
        return `${m.body} Join → ${links.page("/brush")}`;
      default:
        return m.body;
    }
  }

  // True if the phone was newly added to Photon's Users.
  async function register(phone: string, name?: string | null): Promise<boolean> {
    if (!contacts) return false;
    try {
      const added = await contacts.registry.ensure(phone, name);
      if (added) log(`registered ${phone} with Photon`);
      return added;
    } catch (e) {
      log(`registering ${phone} with Photon failed: ${errorText(e)}`);
      return false;
    }
  }

  // Starts the thread on the user's Photon line, so they never need to know which number to text.
  async function sendWelcome(phone: string) {
    try {
      await provider.send(phone, renderWelcome(links.page("/timeline")));
      log(`welcomed ${phone}`);
    } catch (e) {
      log(`welcome to ${phone} failed: ${errorText(e)}`);
    }
  }

  // Add every phone in the database to Photon's Users, e.g. right after someone signs up or is invited, and
  // welcome people who signed up with their own phone. Invited friends get their invite instead.
  async function syncContacts() {
    if (!contacts) return;
    for (const c of await contacts.directory.listPhones()) {
      if ((await register(c.phone, c.name)) && c.verified) await sendWelcome(c.phone);
    }
  }

  async function sendOne(m: OutboxMessage): Promise<SendReport> {
    if (m.channel !== provider.channel) return { ok: false, error: `no ${m.channel} provider` };
    await register(m.address); // a brand-new invitee may not be synced yet
    try {
      const { providerMessageId } = await provider.send(m.address, await textFor(m), { effect: m.effect });
      return { ok: true, providerMessageId };
    } catch (e) {
      return { ok: false, error: errorText(e) };
    }
  }

  // Send everything that's due, one message at a time, to stay well inside Photon's rate limits.
  async function drain(limit = 50): Promise<{ message: OutboxMessage; report: SendReport }[]> {
    const results = [];
    for (const message of await outbox.claim(limit)) {
      const report = await sendOne(message);
      await outbox.complete(message.id, report);
      log(`${report.ok ? "sent" : "failed"} #${message.id} ${message.kind} → ${message.address}${report.ok ? "" : `: ${report.error}`}`);
      results.push({ message, report });
    }
    return results;
  }

  return {
    drain,
    syncContacts,
    sendWelcome,

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
