import { MOODS, type Mood } from "../../types/moods";
import { MoodIcon } from "../icons/Icon";

// FR-C1: one tap on a mood posts the check-in. Icon + label + mood colour, never colour alone.
export function MoodChips({ onPick, disabled, selected, pressed }: {
  onPick: (m: Mood) => void; disabled?: boolean; selected?: Mood | null; pressed?: Mood | null;
}) {
  return (
    <div className="moods" role="group" aria-label="How was it? One tap posts">
      {MOODS.map((m) => (
        <button
          key={m.id}
          className={`mood mood-tone--${m.id}${selected === m.id ? " is-selected" : ""}${pressed === m.id ? " is-pressed" : ""}`}
          onClick={() => onPick(m.id)}
          disabled={disabled}
          aria-pressed={selected === m.id}
        >
          <span className="mood__icon"><MoodIcon mood={m.id} size={26} /></span>
          <span className="mood__label">{m.label}</span>
        </button>
      ))}
    </div>
  );
}
