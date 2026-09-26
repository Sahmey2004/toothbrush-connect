// Photon managed iMessage provider: send labelled messages, typing indicators, tapbacks, threaded replies, effects.
import { Spectrum, type Message, type Space } from "spectrum-ts";
import { effect as withEffect, imessage } from "@spectrum-ts/imessage";
import type { InboundEvent, InboundReaction } from "../../db/client.js";
import { RecipientNotReachable, type InboundListener, type MessagingProvider, type OutgoingMessage } from "./types.js";

const EFFECTS: Record<string, string> = {
  confetti: imessage.effect.message.confetti,
  celebration: imessage.effect.message.celebration,
  fireworks: imessage.effect.message.fireworks,
  balloons: imessage.effect.message.balloons,
};

// Tapback emoji as Photon reports them → the names agent_handle_inbound understands.
const TAPBACKS: Record<string, InboundReaction> = {
  "❤️": "love", "👍": "like", "👎": "dislike", "😂": "laugh", "‼️": "emphasize", "❓": "question",
};

// spectrum-ts types are generic per provider; the agent only uses the shared surface.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

/** Map a Photon message to our inbound event, or null for things we ignore (read receipts, typing…). */
export function toInboundEvent(message: Message): InboundEvent | null {
  if (message.direction !== "inbound" || !message.sender) return null;
  const c = message.content as Loose;
  const base = { channel: "imessage" as const, address: message.sender.id };
  switch (c.type) {
    case "text":
      return { ...base, text: c.text ?? "" };
    case "reaction":
      return { ...base, text: null, reaction: TAPBACKS[c.emoji] ?? "love", replyTo: c.target?.id ?? null };
    case "reply":
      // A threaded reply to one of our updates is a private reply to its author.
      return c.content?.type === "text" ? { ...base, text: `>${c.content.text ?? ""}`, replyTo: c.target?.id ?? null } : null;
    default:
      return null;
  }
}

export async function createIMessageProvider(config: { projectId: string; projectSecret: string }): Promise<MessagingProvider> {
  const app: Loose = await Spectrum({ projectId: config.projectId, projectSecret: config.projectSecret, providers: [imessage.config()] });
  const im: Loose = imessage(app);
  const seen = new Set<string>();

  return {
    name: "imessage",

    async send({ address, body, effect }: OutgoingMessage) {
      try {
        const space = await im.space.create(address);
        const content = effect && EFFECTS[effect] ? withEffect(body, EFFECTS[effect] as Loose) : body;
        const sent = await space.send(content);
        if (!sent?.id) throw new Error("Photon skipped the message");
        return { providerMessageId: sent.id as string };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // Shared Photon lines only message numbers that texted the line first.
        if (msg.includes("Target not allowed")) throw new RecipientNotReachable(`${address} hasn't texted the line yet`);
        throw e;
      }
    },

    async listen(onEvent: InboundListener) {
      for await (const [space, message] of app.messages as AsyncIterable<[Space, Message]>) {
        const event = toInboundEvent(message);
        if (!event || seen.has(message.id)) continue;
        seen.add(message.id);
        if (seen.size > 5000) seen.delete(seen.values().next().value!);
        // Typing indicator while the database handles it, then the reply in the same conversation.
        (space as Loose)
          .responding(() => onEvent(event))
          .then((reply: string | null) => (reply ? (space as Loose).send(reply) : undefined))
          .catch((e: unknown) => console.error("inbound failed:", e));
      }
    },

    // spectrum-ts 12.10 no longer handles SIGINT/SIGTERM; index.ts calls this on shutdown.
    stop: () => app.stop(),
  };
}
