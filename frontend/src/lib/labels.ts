// The PRD's labelled-message catalog, as shown on the website: words only, icons drawn separately.
import { moodInfo, scopeLabel } from "../types/moods";
import type { AudienceLabel } from "../types/api";
import type { Mood, Scope } from "../types/moods";

export const audienceText = (a: AudienceLabel) =>
  a === "close_circle" ? "Close circle" : a === "just_for_you" ? "Just for you" : "Everyone";

// Plain-text summary for places without room for badges, e.g. "Fun · this week · Close circle".
export function checkInLabel(mood: Mood, scope: Scope, audience: AudienceLabel) {
  const parts = [moodInfo(mood).label, scopeLabel(scope)];
  if (audience !== "everyone") parts.push(audienceText(audience));
  return parts.join(" · ");
}

export function timeAgo(iso: string) {
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86_400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

export function joinNames(names: string[]) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
