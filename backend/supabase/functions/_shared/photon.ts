// Outbound delivery through Photon Spectrum (iMessage, with WhatsApp / SMS providers).
// Without PHOTON_PROJECT_ID / PHOTON_PROJECT_SECRET the agent runs in dry-run mode: messages are
// logged and marked sent, so the whole pipeline works locally.

export type Channel = "imessage" | "whatsapp" | "sms";

export interface SendResult {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
}

const projectId = Deno.env.get("PHOTON_PROJECT_ID");
const projectSecret = Deno.env.get("PHOTON_PROJECT_SECRET");
export const dryRun = !projectId || !projectSecret;

// deno-lint-ignore no-explicit-any
let appPromise: Promise<any> | null = null;

function spectrumApp() {
  appPromise ??= (async () => {
    const { Spectrum } = await import("npm:spectrum-ts");
    const { imessage } = await import("npm:spectrum-ts/providers");
    return Spectrum({ projectId, projectSecret, providers: [imessage.config()] });
  })();
  return appPromise;
}

export async function sendMessage(channel: Channel, address: string, body: string, effect?: string | null): Promise<SendResult> {
  if (dryRun) {
    console.log(`[dry-run] ${channel} → ${address}: ${body}${effect ? ` (effect: ${effect})` : ""}`);
    return { ok: true, providerMessageId: `dry-run-${crypto.randomUUID()}` };
  }
  try {
    const app = await spectrumApp();
    // TODO(photon): confirm the Spectrum call for opening a DM by phone number and sending with an
    // effect; the public docs only show replying inside an inbound `space`.
    const space = await app.space({ provider: channel, address });
    const sent = await space.send(body, effect ? { effect } : undefined);
    return { ok: true, providerMessageId: sent?.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
