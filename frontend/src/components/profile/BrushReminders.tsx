import { useEffect, useState } from "react";
import { REMINDER_SLOTS, reminderPatch, toInputTime } from "../../lib/reminders";
import type { Settings } from "../../types/api";

type Slot = (typeof REMINDER_SLOTS)[number];

// Profile panel: a morning and a night brush time. The agent texts 5 minutes before each one that's on, with a link
// to /start. Needs a verified number; `onSave` is Profile's save (it shows "Reminders saved" or the error).
export function BrushReminders({ settings, hasPhone, onSave }: {
  settings: Settings;
  hasPhone: boolean;
  onSave: (patch: Partial<Settings>) => Promise<boolean>;
}) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <section className="pop-set__panel" aria-labelledby="reminders-title">
      <h2 className="pop-set__panel-title" id="reminders-title">Brushing reminders</h2>
      <div className="pop-rems">
        {REMINDER_SLOTS.map((slot) => (
          <ReminderRow key={slot.key} slot={slot} value={settings[slot.key]} disabled={!hasPhone}
            onSave={(time) => onSave(reminderPatch(slot.key, time, timezone))} />
        ))}
      </div>
      <p className="pop-set__meta">
        {hasPhone
          ? `We'll text you 5 minutes before, with a link to start brushing. Times are your local time (${timezone}).`
          : "Add and verify your number above to get reminders."}
      </p>
    </section>
  );
}

// One slot: the switch saves the shown time (or null); a changed time is saved when the picker closes.
function ReminderRow({ slot, value, disabled, onSave }: {
  slot: Slot;
  value: string | null;
  disabled: boolean;
  onSave: (time: string | null) => Promise<boolean>;
}) {
  const on = value != null; // undefined too: a database without migration 0016 yet
  const [time, setTime] = useState(toInputTime(value) || slot.suggested);
  useEffect(() => { if (value) setTime(toInputTime(value)); }, [value]);
  const id = `reminder-${slot.key}`;

  return (
    <div className={`pop-rem${on ? "" : " is-off"}`}>
      <label className="pop-rem__name" htmlFor={id}><span aria-hidden="true">{slot.emoji}</span> {slot.label}</label>
      <button type="button" role="switch" aria-checked={on} aria-label={`${slot.label} reminder`}
        className="pop-rem__switch" disabled={disabled} onClick={() => onSave(on ? null : time || slot.suggested)} />
      <input id={id} type="time" className="pop-set__input pop-rem__time" value={time} required
        disabled={disabled || !on}
        onChange={(e) => setTime(e.target.value)}
        onBlur={() => { if (on && time && time !== toInputTime(value)) onSave(time); }} />
    </div>
  );
}
