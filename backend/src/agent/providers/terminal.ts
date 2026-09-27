// AGENT_MODE=terminal: messages are printed instead of sent, and stdin lines become inbound texts.
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import type { InboundEvent, MessagingProvider } from "./types.js";

export function createTerminalProvider(
  io: { out?: Writable; in?: Readable; from?: string } = {},
): MessagingProvider {
  const out = io.out ?? process.stdout;
  let rl: ReturnType<typeof createInterface> | null = null;
  return {
    channel: "imessage",

    async send(address, text) {
      const providerMessageId = `terminal-${randomUUID()}`;
      out.write(`\n→ ${address} (${providerMessageId})\n${text}\n`);
      return { providerMessageId };
    },

    async *inbound(): AsyncGenerator<InboundEvent> {
      if (!io.in) return;
      rl = createInterface({ input: io.in });
      for await (const line of rl) {
        if (!line.trim()) continue;
        yield { type: "text", channel: "imessage", from: io.from ?? "+15550000000", messageId: randomUUID(), text: line };
      }
    },

    async stop() {
      rl?.close();
    },
  };
}
