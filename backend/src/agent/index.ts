// Messaging agent: drains the database's outbox (`outbound_messages`) and sends each message through Photon,
// and answers texts and tapbacks coming back. The website feed is delivered by the database separately; a
// failure here never affects it.
import { setTimeout as sleep } from "node:timers/promises";
import { loadAgentConfig, type AgentConfig } from "./config.js";
import { createInboundHandler } from "./inbound/handler.js";
import type { Inbox, LinkBuilder, Outbox, OutboxMessage, SendReport } from "./ports.js";
import { connectIMessage, createIMessageProvider } from "./providers/imessage.js";
import { createTerminalProvider } from "./providers/terminal.js";
import type { MessagingProvider } from "./providers/types.js";
import { renderUpdate } from "./templates/messages.js";

export type * from "./ports.js";

export interface AgentDeps {
  provider: MessagingProvider;
  outbox: Outbox;
  inbox: Inbox;
  links: LinkBuilder;
  log?: (line: string) => void;
}

export function createAgent({ provider, outbox, inbox, links, log = console.log }: AgentDeps) {
  const handleInbound = createInboundHandler({ provider, inbox, links });
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

  async function sendOne(m: OutboxMessage): Promise<SendReport> {
    if (m.channel !== provider.channel) return { ok: false, error: `no ${m.channel} provider` };
    try {
      const { providerMessageId } = await provider.send(m.address, await textFor(m));
      return { ok: true, providerMessageId };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
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

    // Poll the outbox until `signal` aborts. The database's cron delivers held check-ins every 5 s.
    async run({ intervalMs = 2000, signal }: { intervalMs?: number; signal?: AbortSignal } = {}) {
      while (!signal?.aborted) {
        try {
          await drain();
        } catch (e) {
          log(`outbox poll failed: ${e instanceof Error ? e.message : String(e)}`);
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
          log(`inbound from ${event.from} failed: ${e instanceof Error ? e.message : String(e)}`);
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
