// Messaging agent: when a check-in's hold ends, send each recipient the labelled update through Photon.
// The website feed is delivered separately; a failure here never affects it.
import { loadAgentConfig, type AgentConfig } from "./config.js";
import type { DeliverableCheckIn, DeliveryLog, LinkBuilder, Recipient } from "./ports.js";
import { connectIMessage, createIMessageProvider } from "./providers/imessage.js";
import { createTerminalProvider } from "./providers/terminal.js";
import { RecipientNotReachable, type MessagingProvider } from "./providers/types.js";
import { renderUpdate } from "./templates/messages.js";

export type * from "./ports.js";

export type DeliveryOutcome =
  | { recipientId: string; status: "sent"; providerMessageId: string }
  | { recipientId: string; status: "skipped"; reason: "no_phone" | "opted_out" | "already_sent" }
  | { recipientId: string; status: "failed"; error: string; retryable: boolean };

export interface AgentDeps {
  provider: MessagingProvider;
  deliveries: DeliveryLog;
  links: LinkBuilder;
}

export function createAgent({ provider, deliveries, links }: AgentDeps) {
  async function deliverOne(checkIn: DeliverableCheckIn, r: Recipient): Promise<DeliveryOutcome> {
    const recipientId = r.userId;
    if (r.optedOut) return { recipientId, status: "skipped", reason: "opted_out" };
    if (!r.phone) return { recipientId, status: "skipped", reason: "no_phone" };

    const key = { checkInId: checkIn.id, recipientId };
    if (!(await deliveries.claim(key))) return { recipientId, status: "skipped", reason: "already_sent" };

    try {
      const text = renderUpdate(checkIn, await links.checkIn(key));
      const { providerMessageId } = await provider.send(r.phone, text);
      await deliveries.markSent(key, providerMessageId);
      return { recipientId, status: "sent", providerMessageId };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      const retryable = !(e instanceof RecipientNotReachable);
      await deliveries.markFailed(key, { error, retryable });
      return { recipientId, status: "failed", error, retryable };
    }
  }

  return {
    // Call once the hold has ended and the check-in is in the recipients' feeds. Safe to call again for
    // the same check-in: recipients already sent to are skipped.
    async deliverCheckIn(checkIn: DeliverableCheckIn, recipients: Recipient[]): Promise<DeliveryOutcome[]> {
      const outcomes: DeliveryOutcome[] = [];
      // One at a time, to stay well inside Photon's rate limits.
      for (const r of recipients) outcomes.push(await deliverOne(checkIn, r));
      return outcomes;
    },

    stop: () => provider.stop(),
  };
}

export type Agent = ReturnType<typeof createAgent>;

// The provider AGENT_MODE asks for: Photon iMessage, or printing to the terminal.
export async function createProvider(config: AgentConfig = loadAgentConfig()): Promise<MessagingProvider> {
  return config.mode === "photon" ? createIMessageProvider(await connectIMessage(config.photon)) : createTerminalProvider();
}
