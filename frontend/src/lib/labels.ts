// The PRD's labelled-message catalog, as shown on the website.
import { moodInfo, scopeLabel } from "../types/moods";
import type { AudienceLabel } from "../types/api";
import type { Mood, Scope } from "../types/moods";

export function checkInLabel(mood: Mood, scope: Scope, audience: AudienceLabel) {
  const m = moodInfo(mood);
  if (audience === "close_circle") return `👥 CLOSE CIRCLE · ${m.word}`;
  if (audience === "just_for_you") return `💌 JUST FOR YOU · ${m.word}`;
  return `${m.emoji} ${m.word} · ${scopeLabel(scope)}`;
}

export function timeAgo(iso: string) {
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86_400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}
