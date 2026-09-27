// Inbound messages from Photon Spectrum: STOP / START, YES to invites, tapbacks and `>` replies.
// Posting check-ins happens on the website, so anything else gets a pointer there.
import { admin } from "../_shared/admin.ts";
import { type Channel, sendMessage } from "../_shared/photon.ts";

const SITE_URL = Deno.env.get("SITE_URL") ?? "http://localhost:5173";
const WEBHOOK_SECRET = Deno.env.get("PHOTON_WEBHOOK_SECRET");

// TODO(photon): map Spectrum's webhook payload and signature onto this shape.
interface Inbound {
  channel: Channel;
  from: string;             // E.164
  text?: string;
  replyToMessageId?: string; // agent message the user tapped back on or replied to
  reaction?: "love" | "like" | "dislike" | "laugh" | "emphasize" | "question";
}

function replyFor(action: string, names: string[]): string | null {
  switch (action) {
    case "stopped":
      return "[👋 INVITE] You won't get more messages from Toothbrush Connect. Text START to come back.";
    case "started":
      return `[👋 INVITE] Welcome back. Friends' updates will arrive here again. Brush with them at ${SITE_URL}`;
    case "joined":
      return `[👋 INVITE] You're in ${names.join(", ")}'s circle. Their updates will arrive here. Post yours at ${SITE_URL}`;
    case "nothing_pending":
      return `[👋 INVITE] No invites waiting. Start your own circle at ${SITE_URL}`;
    case "no_update_to_reply":
      return "[💬 REPLY] There's no friend update to reply to yet.";
    case "help":
      return `[❓ YOUR TURN] Post how your day went at ${SITE_URL} while you brush. Tapback a friend's update to react, start a text with > to reply, or text STOP to opt out.`;
    default:
      return null;  // reacted, replied, ignored: stay quiet (PRD: few messages)
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (WEBHOOK_SECRET && req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const msg = (await req.json()) as Inbound;
  if (!msg.from || !msg.channel) return new Response("Bad request", { status: 400 });

  const { data, error } = await admin.rpc("agent_handle_inbound", {
    p_channel: msg.channel,
    p_address: msg.from,
    p_text: msg.text ?? "",
    p_reply_to: msg.replyToMessageId ?? null,
    p_reaction: msg.reaction ?? null,
  });
  if (error) {
    console.error("agent_handle_inbound failed", error);
    return Response.json({ error: error.message }, { status: 500 });
  }

  const reply = replyFor(data.action, data.names ?? []);
  // Replies go straight back on the inbound channel (FR-M1: within 3 s), including the one STOP
  // confirmation carriers allow.
  if (reply) await sendMessage(msg.channel, msg.from, reply);
  // Reactions and replies queue a message to the author; send it now rather than waiting for cron.
  if (data.action === "reacted" || data.action === "replied") {
    await admin.functions.invoke("agent-dispatch").catch(() => {});
  }
  return Response.json({ action: data.action });
});
