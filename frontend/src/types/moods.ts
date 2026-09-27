// FR-C1: fixed mood mapping, the same on every channel. Keep in sync with public.mood_word / mood_emoji.
// The circle/brush screens draw each mood with a line icon (components/icons); the pop pages (Start) still show the emoji.
export type Mood = "fun" | "stressful" | "boring" | "just_okay";
export type Scope = "today" | "this_week";

export interface MoodInfo {
  id: Mood;
  digit: 1 | 2 | 3 | 4;
  emoji: string;
  label: string;
  word: string;
}

export const MOODS: MoodInfo[] = [
  { id: "stressful", digit: 2, emoji: "😣", label: "Stressful", word: "STRESSFUL" },
  { id: "fun", digit: 1, emoji: "😄", label: "Fun", word: "FUN" },
  { id: "boring", digit: 3, emoji: "😐", label: "Boring", word: "BORING" },
  { id: "just_okay", digit: 4, emoji: "🙂", label: "Just okay", word: "JUST OKAY" },
];

export const moodInfo = (m: Mood) => MOODS.find((x) => x.id === m)!;

export const scopeLabel = (s: Scope) => (s === "this_week" ? "this week" : "today");
