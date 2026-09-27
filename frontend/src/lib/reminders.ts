// Brushing reminders (Profile): the agent texts 5 minutes before each time that's switched on (migration 0016).
import type { Settings } from "../types/api";

export type ReminderKey = "morning_reminder" | "night_reminder";

export const REMINDER_SLOTS: { key: ReminderKey; label: string; emoji: string; suggested: string }[] = [
  { key: "morning_reminder", label: "Morning", emoji: "🌅", suggested: "07:30" },
  { key: "night_reminder", label: "Night", emoji: "🌙", suggested: "22:30" },
];

// Postgres sends "07:30:00"; <input type="time"> wants "07:30".
export const toInputTime = (t: string | null): string => (t ? t.slice(0, 5) : "");

// One slot's time ("HH:MM", or null to switch it off), saved with this device's timezone, so reminders follow
// where the person is now.
export function reminderPatch(
  key: ReminderKey,
  time: string | null,
  timezone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): Partial<Settings> {
  return key === "morning_reminder" ? { morning_reminder: time, timezone } : { night_reminder: time, timezone };
}
