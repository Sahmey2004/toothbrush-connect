// Photon-managed iMessage through Spectrum. Outbound opens a DM by phone number; inbound comes from the
// SDK's own message stream, so no webhook or public URL is needed (see PLAN.md "Photon Spectrum facts").
import { Spectrum, type Message } from "spectrum-ts";
import { imessage } from "@spectrum-ts/imessage";
import { RecipientNotReachable, type InboundEvent, type MessagingProvider } from "./types.js";

export async function connectIMessage(photon: { projectId: string; projectSecret: string }) {
  return Spectrum({ ...photon, providers: [imessage.config()] });
}

type SpectrumApp = Awaited<ReturnType<typeof connectIMessage>>;

// Spectrum reports a number that hasn't texted the shared line as
// `AuthenticationError: [spectrum-imessage] Target not allowed for this project`.
function isTargetNotAllowed(e: unknown): boolean {
  return e instanceof Error && /target not allowed/i.test(e.message);
}

export function toInboundEvent(message: Message): InboundEvent | null {
  if (message.direction !== "inbound" || !message.sender) return null;
  const base = { channel: "imessage" as const, from: message.sender.id, messageId: message.id };
  const content = message.content;
  switch (content.type) {
    case "text":
      return { ...base, type: "text", text: content.text };
    case "reaction":
      return { ...base, type: "reaction", emoji: content.emoji, targetMessageId: content.target.id };
    default:
      return null; // attachments, typing, read receipts, …
  }
}

export function createIMessageProvider(app: SpectrumApp): MessagingProvider {
  const im = imessage(app);
  return {
    channel: "imessage",

    async send(address, text) {
      try {
        const space = await im.space.create(address);
        const sent = await space.send(text);
        if (!sent) throw new Error("Spectrum returned no message for send");
        return { providerMessageId: sent.id };
      } catch (e) {
        if (isTargetNotAllowed(e)) throw new RecipientNotReachable("imessage", address, { cause: e });
        throw e;
      }
    },

    async *inbound() {
      for await (const [, message] of app.messages) {
        const event = toInboundEvent(message);
        if (event) yield event;
      }
    },

    stop: () => app.stop(),
  };
}
