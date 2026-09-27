// iMessage label catalog (PRD "iMessage label catalog"). Every outbound message starts with one of these (FR-D3).
import { MOODS, type Mood, type Scope } from "../../domain/moods.js";
import type { ServerEvent } from "../../domain/events.js";

export type AudienceLabel = Extract<ServerEvent, { type: "check_in.delivered" }>["audienceLabel"];

export type LabelSpec =
  | { kind: "update"; mood: Mood | null; scope: Scope; audience: AudienceLabel }
  | { kind: "batch"; count: number }
  | { kind: "brushing_now" }
  | { kind: "edited" }
  | { kind: "reaction" }
  | { kind: "reply" }
  | { kind: "code" }
  | { kind: "invite" }
  | { kind: "digest" }
  | { kind: "post_on_web" };

export const SCOPE_TEXT: Record<Scope, string> = { today: "today", this_week: "this week" };

const FIXED: Record<Exclude<LabelSpec["kind"], "update" | "batch">, string> = {
  brushing_now: "🪥 BRUSHING NOW",
  edited: "✏️ EDITED",
  reaction: "❤️ REACTION",
  reply: "💬 REPLY",
  code: "🔑 CODE",
  invite: "👋 INVITE",
  digest: "📬 DIGEST",
  post_on_web: "ℹ️ POST ON THE WEB",
};

// Everyone:      [😣 STRESSFUL · today]
// List / several: [👥 CLOSE CIRCLE · STRESSFUL · today]
// One friend:    [💌 JUST FOR YOU · STRESSFUL · today]
// Scope is kept in the audience labels too, since FR-C2 says the scope is shown in labels.
function updateLabel(mood: Mood | null, scope: Scope, audience: AudienceLabel): string {
  const scopeText = SCOPE_TEXT[scope];
  // Text-only check-in (no mood): drop the mood part, matching public.check_in_message.
  if (!mood) {
    switch (audience) {
      case "everyone":
        return scopeText;
      case "close_circle":
        return "👥 CLOSE CIRCLE";
      case "just_for_you":
        return "💌 JUST FOR YOU";
    }
  }
  const { emoji, label } = MOODS[mood];
  const moodText = label.toUpperCase();
  switch (audience) {
    case "everyone":
      return `${emoji} ${moodText} · ${scopeText}`;
    case "close_circle":
      return `👥 CLOSE CIRCLE · ${moodText} · ${scopeText}`;
    case "just_for_you":
      return `💌 JUST FOR YOU · ${moodText} · ${scopeText}`;
  }
}

export function label(spec: LabelSpec): string {
  switch (spec.kind) {
    case "update":
      return `[${updateLabel(spec.mood, spec.scope, spec.audience)}]`;
    case "batch":
      if (!Number.isInteger(spec.count) || spec.count < 2) {
        throw new Error(`batch label needs at least 2 updates, got ${spec.count}`);
      }
      return `[📦 ${spec.count} UPDATES]`;
    default:
      return `[${FIXED[spec.kind]}]`;
  }
}

// Every label the catalog can produce, as a pattern. The FR-D3 lint checks messages against this.
const MOOD_WORDS = Object.values(MOODS).map((m) => m.label.toUpperCase());
const MOOD_EMOJI = Object.values(MOODS).map((m) => m.emoji);
const SCOPES = Object.values(SCOPE_TEXT);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const alt = (xs: string[]) => `(?:${xs.map(escape).join("|")})`;

const moodPart = `${alt(MOOD_WORDS)} · ${alt(SCOPES)}`;
export const CATALOG_LABEL = new RegExp(
  "^\\[(?:" +
    [
      `${alt(MOOD_EMOJI)} ${moodPart}`,
      `👥 CLOSE CIRCLE · ${moodPart}`,
      `💌 JUST FOR YOU · ${moodPart}`,
      // text-only check-ins (no mood): scope alone, or the audience label by itself
      alt(SCOPES),
      escape("👥 CLOSE CIRCLE"),
      escape("💌 JUST FOR YOU"),
      `📦 \\d+ UPDATES`,
      ...Object.values(FIXED).map(escape),
    ].join("|") +
    ")\\]",
  "u",
);
