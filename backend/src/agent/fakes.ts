// In-memory ports for tests and dev.ts. They define the behavior the real implementations must match.
import type { DeliveryKey, DeliveryLog, LinkBuilder } from "./ports.js";
import type { MessagingProvider, SendResult } from "./providers/types.js";

type Row =
  | { status: "sending" }
  | { status: "sent"; providerMessageId: string }
  | { status: "failed"; error: string; retryable: boolean };

export function createMemoryDeliveryLog(): DeliveryLog & { rows: Map<string, Row> } {
  const rows = new Map<string, Row>();
  const id = (k: DeliveryKey) => `${k.checkInId}:${k.recipientId}`;
  return {
    rows,
    async claim(k) {
      const row = rows.get(id(k));
      if (row && !(row.status === "failed" && row.retryable)) return false;
      rows.set(id(k), { status: "sending" });
      return true;
    },
    async markSent(k, providerMessageId) {
      rows.set(id(k), { status: "sent", providerMessageId });
    },
    async markFailed(k, failure) {
      rows.set(id(k), { status: "failed", ...failure });
    },
  };
}

export function createFixedLinks(base = "https://tbc.link"): LinkBuilder {
  return { checkIn: async ({ checkInId }) => `${base}/c/${checkInId}` };
}

// Records sends; `fail` decides per address whether a send throws.
export function createFakeProvider(fail: (address: string) => Error | null = () => null) {
  const sent: { address: string; text: string }[] = [];
  let n = 0;
  const provider: MessagingProvider = {
    channel: "imessage",
    async send(address, text): Promise<SendResult> {
      const error = fail(address);
      if (error) throw error;
      sent.push({ address, text });
      return { providerMessageId: `fake-${++n}` };
    },
    async *inbound() {},
    async stop() {},
  };
  return { provider, sent };
}
