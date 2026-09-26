// Replies to inbound texts; every one starts with a catalog label (FR-D3).
// Replies to verification carry no link: Photon's deliverability guide warns against links in the
// first message a number gets from a line.
import type { InboundResult } from "../../db/client.js";

const list = (names: string[]) =>
  names.length <= 2 ? names.join(" and ") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;

export function replyFor(result: InboundResult, siteUrl: string): string | null {
  switch (result.action) {
    case "verified": {
      const hi = result.display_name ? `, ${result.display_name}` : "";
      const from = result.names.length ? ` Updates from ${list(result.names)} will land here.` : " Friends' updates will land here.";
      return `[✅ CONNECTED] You're all set${hi}!${from} Text STOP any time.`;
    }
    case "code_unknown":
    case "code_expired":
      return "[🔑 CODE] That code didn't work. Get a new one on the website and text it again.";
    case "phone_mismatch":
      return "[🔑 CODE] That code is for a different number. Text it from the phone you entered on the website.";
    case "phone_taken":
      return "[🔑 CODE] This number is already linked to another account.";
    case "stopped":
      return "[🔕 STOPPED] You won't get more messages. Text START to come back.";
    case "started":
      return "[✅ CONNECTED] Welcome back! Friends' updates will arrive here again.";
    case "joined":
      return `[👋 INVITE] You're in ${list(result.names)}'s circle. Their updates will arrive here → ${siteUrl}`;
    case "nothing_pending":
      return `[ℹ️ POST ON THE WEB] No invites waiting. Start your own circle → ${siteUrl}`;
    case "no_update_to_reply":
      return "[💬 REPLY] There's no update to reply to yet.";
    case "help":
      return `[ℹ️ POST ON THE WEB] Share your update while you brush → ${siteUrl}`;
    default:
      return null; // reacted, replied, ignored: stay quiet
  }
}
