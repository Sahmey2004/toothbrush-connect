// No Photon credentials: log messages instead of sending them, so the whole pipeline runs locally.
// Inbound texts can be simulated with POST /dev/inbound (see src/agent/dev-server.ts).
import type { InboundListener, MessagingProvider, OutgoingMessage } from "./types.js";

export function createDryRunProvider(log: (line: string) => void = console.log): MessagingProvider & { inbound?: InboundListener } {
  let n = 0;
  let release: (() => void) | undefined;
  const provider: MessagingProvider & { inbound?: InboundListener } = {
    name: "dry-run",
    async send({ address, body, effect }: OutgoingMessage) {
      log(`[dry-run] → ${address}: ${body}${effect ? `  (${effect})` : ""}`);
      return { providerMessageId: `dry-run-${Date.now()}-${++n}` };
    },
    listen(onEvent) {
      provider.inbound = onEvent;
      return new Promise<void>((resolve) => { release = resolve; });
    },
    async stop() { release?.(); },
  };
  return provider;
}
