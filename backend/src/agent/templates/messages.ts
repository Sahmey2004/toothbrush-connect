// Outbound message templates. Each is a pure function returning `[label] body\n<cta> → <link>` (FR-D3).
// Inputs never carry recipient lists, so a message cannot name other recipients (FR-R6, FR-R7).
import { MOODS, type Mood, type Scope } from "../../domain/moods.js";
import { label, SCOPE_TEXT, type AudienceLabel } from "./labels.js";

export const MAX_TEXT = 140; // FR-C3
export const MAX_BATCH = 3; // FR-D4

export interface UpdateItem {
  authorName: string;
  mood: Mood;
  scope: Scope;
  audience: AudienceLabel;
  text?: string | null;
}

// User-supplied text is flattened to one line so it can't push the label off the first line,
// fake a second label, or put anything after the link.
function clean(s: string, max: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

const name = (s: string) => clean(s, 40) || "A friend";

function assertLink(link: string): string {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new Error(`template link is not a URL: ${link}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`template link must be http(s): ${link}`);
  }
  return link;
}

function compose(head: string, body: string, cta: string, link: string): string {
  return `${head} ${body}\n${cta} → ${assertLink(link)}`;
}

function quoted(text: string | null | undefined): string {
  const t = text ? clean(text, MAX_TEXT) : "";
  return t ? `"${t}"` : "";
}

// [😣 STRESSFUL · today] Priya: "moving apartments, send help"
// React or share yours → https://tbc.link/r/a8K2
export function renderUpdate(item: UpdateItem, link: string): string {
  const q = quoted(item.text);
  const body = q ? `${name(item.authorName)}: ${q}` : `${name(item.authorName)} checked in.`;
  return compose(label({ kind: "update", ...item }), body, "React or share yours", link);
}

// [📦 3 UPDATES]
// 😄 Sam (today): "finally finished the move"
// 😣 Priya (this week, just for you)
// See them all → link
export function renderBatch(items: UpdateItem[], link: string): string {
  if (items.length < 2 || items.length > MAX_BATCH) {
    throw new Error(`a batch holds 2–${MAX_BATCH} updates, got ${items.length}`);
  }
  const lines = items.map((i) => {
    const tags = [SCOPE_TEXT[i.scope]];
    if (i.audience === "close_circle") tags.push("close circle");
    if (i.audience === "just_for_you") tags.push("just for you");
    const q = quoted(i.text);
    return `${MOODS[i.mood].emoji} ${name(i.authorName)} (${tags.join(", ")})${q ? `: ${q}` : ""}`;
  });
  return `${label({ kind: "batch", count: items.length })}\n${lines.join("\n")}\nSee them all → ${assertLink(link)}`;
}

// [✏️ EDITED] Priya: 😣 Stressful · today "moving apartments, send help"
export function renderEdited(item: Omit<UpdateItem, "audience">, link: string): string {
  const { emoji, label: moodLabel } = MOODS[item.mood];
  const q = quoted(item.text);
  const body = `${name(item.authorName)}: ${emoji} ${moodLabel} · ${SCOPE_TEXT[item.scope]}${q ? ` ${q}` : ""}`;
  return compose(label({ kind: "edited" }), body, "See the update", link);
}

// [🪥 BRUSHING NOW] Sam is brushing. Join → link
export function renderBrushingNow(p: { friendName: string }, link: string): string {
  return `${label({ kind: "brushing_now" })} ${name(p.friendName)} is brushing. Join → ${assertLink(link)}`;
}

// [❤️ REACTION] Sam reacted 👋 to your check-in.
export function renderReaction(p: { fromName: string; emoji: string }, link: string): string {
  const emoji = clean(p.emoji, 8);
  return compose(label({ kind: "reaction" }), `${name(p.fromName)} reacted ${emoji} to your check-in.`, "See it", link);
}

// [💬 REPLY] Sam: "hang in there!"
export function renderReply(p: { fromName: string; text: string }, link: string): string {
  const q = quoted(p.text) || "sent you a reply.";
  return compose(label({ kind: "reply" }), `${name(p.fromName)}: ${q}`, "Reply", link);
}

// [🔑 CODE] 123456 is your Toothbrush Connect code.
export function renderCode(p: { code: string }, link: string): string {
  if (!/^\d{4,8}$/.test(p.code)) throw new Error("sign-in code must be 4–8 digits");
  return compose(label({ kind: "code" }), `${p.code} is your Toothbrush Connect code. Don't share it.`, "Or open", link);
}

// [👋 INVITE] Priya invited you to Toothbrush Connect: check in with friends while you brush.
export function renderInvite(p: { inviterName: string }, link: string): string {
  const body = `${name(p.inviterName)} invited you to Toothbrush Connect: check in with friends while you brush.`;
  return compose(label({ kind: "invite" }), body, "Join", link);
}

// [📬 DIGEST] This week: 12 updates from 4 friends.
export function renderDigest(p: { updates: number; friends: number }, link: string): string {
  const u = `${p.updates} update${p.updates === 1 ? "" : "s"}`;
  const f = `${p.friends} friend${p.friends === 1 ? "" : "s"}`;
  return compose(label({ kind: "digest" }), `This week: ${u} from ${f}.`, "Catch up", link);
}

// [ℹ️ POST ON THE WEB] This line only delivers updates. Text STOP to opt out. (FR-D5 auto-reply)
export function renderPostOnWeb(link: string): string {
  const body = "This line only delivers updates. Text STOP to opt out.";
  return compose(label({ kind: "post_on_web" }), body, "Post updates on the website", link);
}

// Answers to texted commands. The catalog has no label of its own for these, so they use the info label.

// The one confirmation carriers allow after STOP (FR-D6).
export function renderStopped(link: string): string {
  const body = "You won't get more messages here. Text START to turn them back on.";
  return compose(label({ kind: "post_on_web" }), body, "Updates stay on the website", link);
}

export function renderStarted(link: string): string {
  const body = "You're back. Friends' updates will arrive here again.";
  return compose(label({ kind: "post_on_web" }), body, "Post yours on the website", link);
}

export function renderNothingPending(link: string): string {
  return compose(label({ kind: "post_on_web" }), "No invites waiting for you.", "Start your own circle", link);
}

// First message to someone who signed up with their phone: it starts the thread on their Photon line, so they
// never need to know which number to text.
export function renderWelcome(link: string): string {
  const body = "You're set up for Toothbrush Connect. Friends' updates will arrive here. Text STOP to opt out.";
  return compose(label({ kind: "post_on_web" }), body, "Post yours on the website", link);
}

// Answers to "Verify 123456" from the website's phone check. These carry no link: the verification text is
// usually the first exchange a number has with the line, and Photon's deliverability guide warns against links
// in that first message.

const listNames = (names: string[]) =>
  names.length <= 2 ? names.join(" and ") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;

// [✅ CONNECTED] You're all set, Hwaejin! Updates from Sahmey, Roy and 1 more will land here. Text STOP any time.
export function renderVerified(p: { displayName?: string | null; friendNames: string[] }): string {
  const hi = p.displayName?.trim() ? `, ${name(p.displayName)}` : "";
  const friends = p.friendNames.map(name);
  const from = friends.length ? `Updates from ${listNames(friends)} will land here.` : "Friends' updates will land here.";
  return `${label({ kind: "connected" })} You're all set${hi}! ${from} Text STOP any time.`;
}

export type CodeProblem = "code_unknown" | "code_expired" | "phone_mismatch" | "phone_taken";

const CODE_PROBLEMS: Record<CodeProblem, string> = {
  code_unknown: "That code didn't work. Get a new one on the website and text it again.",
  code_expired: "That code didn't work. Get a new one on the website and text it again.",
  phone_mismatch: "That code is for a different number. Text it from the phone you entered on the website.",
  phone_taken: "This number is already linked to another account.",
};

// [🔑 CODE] That code didn't work. Get a new one on the website and text it again.
export function renderCodeProblem(problem: CodeProblem): string {
  return `${label({ kind: "code" })} ${CODE_PROBLEMS[problem]}`;
}

// [👋 INVITE] You're in Sahmey's circle. Their updates will arrive here.
export function renderJoined(p: { inviterNames: string[] }, link: string): string {
  const names = p.inviterNames.map(name);
  const who = names.length ? names.join(", ") + "'s" : "your friend's";
  const body = `You're in ${who} circle. Their updates will arrive here.`;
  return compose(label({ kind: "invite" }), body, "Post yours on the website", link);
}
