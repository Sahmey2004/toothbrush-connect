import { describe, expect, it } from "vitest";
import { REMINDER_SLOTS, reminderPatch, toInputTime } from "./reminders";

describe("toInputTime", () => {
  it("drops the seconds Postgres adds", () => expect(toInputTime("07:30:00")).toBe("07:30"));
  it("keeps HH:MM as it is", () => expect(toInputTime("22:05")).toBe("22:05"));
  it("is empty when the reminder is off", () => expect(toInputTime(null)).toBe(""));
});

describe("reminderPatch", () => {
  it("saves the time with the timezone", () => {
    expect(reminderPatch("night_reminder", "22:30", "America/Chicago")).toEqual({
      night_reminder: "22:30",
      timezone: "America/Chicago",
    });
  });

  it("switches a slot off with null", () => {
    expect(reminderPatch("morning_reminder", null, "Asia/Kolkata")).toEqual({
      morning_reminder: null,
      timezone: "Asia/Kolkata",
    });
  });

  it("defaults to this device's timezone, so an account still on UTC gets fixed", () => {
    expect(reminderPatch("morning_reminder", "07:30").timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
});

describe("REMINDER_SLOTS", () => {
  it("suggest 7:30 AM and 10:30 PM", () => {
    expect(REMINDER_SLOTS.map((s) => [s.key, s.suggested])).toEqual([
      ["morning_reminder", "07:30"],
      ["night_reminder", "22:30"],
    ]);
  });
});
