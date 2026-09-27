// Inbound texts and tapbacks. The database's agent_handle_inbound does the work ("Verify 123456" phone checks,
// STOP / START, YES to accept invites, tapbacks and "> replies" recorded as reactions); this answers with the
// right message. Inbound text never creates a check-in (FR-C7).
import type { Inbox, InboundResult, LinkBuilder } from "../ports.js";
import type { InboundEvent, MessagingProvider } from "../providers/types.js";
import {
  renderCodeProblem,
  renderJoined,
  renderNothingPending,
  renderPostOnWeb,
  renderStarted,
  renderStopped,
  renderWelcome,
} from "../templates/messages.js";

// FR-D5: at most one auto-reply per user per 12 hours.
export const AUTO_REPLY_EVERY_MS = 12 * 60 * 60 * 1000;

// iMessage tapback emoji → the names agent_handle_inbound expects.
const TAPBACKS: Record<string, string> = {
  "❤️": "love",
  "👍": "like",
  "👎": "dislike",
  "😂": "laugh",
  "‼️": "emphasize",
  "❓": "question",
};

export interface InboundDeps {
  provider: MessagingProvider;
  inbox: Inbox;
  links: LinkBuilder;
  now?: () => number;
}

export function createInboundHandler({ provider, inbox, links, now = Date.now }: InboundDeps) {
  // In memory: a restart can allow one extra auto-reply, which is fine.
  const lastAutoReply = new Map<string | null, number>();
  const home = links.page("/timeline");

  function replyFor(r: InboundResult): string | null {
    switch (r.action) {
      case "stopped":
        return renderStopped(home);
      case "started":
        return renderStarted(home);
      case "joined":
        return renderJoined({ inviterNames: r.names }, home);
      case "nothing_pending":
        return renderNothingPending(links.page("/circle"));
      case "verified":
        return renderWelcome(home);
      case "code_unknown":
      case "code_expired":
      case "phone_mismatch":
      case "phone_taken":
        return renderCodeProblem(r.action, links.page("/profile"));
      case "help":
      case "no_update_to_reply": {
        const last = lastAutoReply.get(r.userId);
        if (last !== undefined && now() - last < AUTO_REPLY_EVERY_MS) return null;
        lastAutoReply.set(r.userId, now());
        return renderPostOnWeb(home);
      }
      case "reacted":
      case "replied":
      case "ignored":
        return null; // the database queued any notice for the author; stay quiet here
    }
  }

  // Returns the reply that was sent, if any.
  return async function handleInbound(event: InboundEvent): Promise<string | null> {
    const result = await inbox.handle(
      event.type === "text"
        ? { channel: event.channel, from: event.from, text: event.text, replyTo: null, reaction: null }
        : {
            channel: event.channel,
            from: event.from,
            text: "",
            replyTo: event.targetMessageId,
            reaction: TAPBACKS[event.emoji] ?? "love",
          },
    );
    const reply = replyFor(result);
    if (reply) await provider.send(event.from, reply);
    return reply;
  };
}
