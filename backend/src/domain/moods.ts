// FR-C1: fixed mood mapping. Keep in sync with frontend/src/types/moods.ts.
export type Mood = "fun" | "stressful" | "boring" | "just_okay";
export type Scope = "today" | "this_week";

export const MOODS: Record<Mood, { emoji: string; label: string }> = {
  fun:       { emoji: "😄", label: "Fun" },
  stressful: { emoji: "😣", label: "Stressful" },
  boring:    { emoji: "😐", label: "Boring" },
  just_okay: { emoji: "🙂", label: "Just okay" },
};
