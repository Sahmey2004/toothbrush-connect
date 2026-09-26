// Photon-managed iMessage through Spectrum. Outbound opens a DM by phone number; inbound comes from the
// SDK's own message stream, so no webhook or public URL is needed (see PLAN.md "Photon Spectrum facts").
import { Spectrum, type Message } from "spectrum-ts";
import { effect as withEffect, imessage, type IMessageMessageEffect } from "@spectrum-ts/imessage";
import { RecipientNotReachable, type InboundEvent, type MessagingProvider } from "./types.js";

// outbound_messages.effect → iMessage screen effect. Unknown names are sent without one.
const EFFECTS: Record<string, IMessageMessageEffect> = {
  confetti: imessage.effect.message.confetti,
  celebration: imessage.effect.message.celebration,
  fireworks: imessage.effect.message.fireworks,
  balloons: imessage.effect.message.balloons,
};

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
    case "reply":
      // A threaded reply to one of our updates is a private "> reply" to its author.
      return content.content.type === "text"
        ? { ...base, type: "text", text: `>${content.content.text}`, replyTo: content.target.id }
        : null;
    default:
      return null; // attachments, typing, read receipts, …
  }
}

export function createIMessageProvider(app: SpectrumApp): MessagingProvider {
  const im = imessage(app);
  return {
    channel: "imessage",

    async send(address, text, options) {
      try {
        const space = await im.space.create(address);
        const screenEffect = options?.effect ? EFFECTS[options.effect] : undefined;
        const sent = await space.send(screenEffect ? withEffect(text, screenEffect) : text);
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
