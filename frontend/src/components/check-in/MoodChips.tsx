import { MOODS, type Mood } from "../../types/moods";

// FR-C1: one tap on a mood posts the check-in.
export function MoodChips({ onPick, disabled, selected }: { onPick: (m: Mood) => void; disabled?: boolean; selected?: Mood | null }) {
  return (
    <div className="moods" role="group" aria-label="How was it?">
      {MOODS.map((m) => (
        <button
          key={m.id}
          className={`mood mood--${m.id}${selected === m.id ? " mood--selected" : ""}`}
          onClick={() => onPick(m.id)}
          disabled={disabled}
          aria-pressed={selected === m.id}
        >
          <span className="mood__emoji" aria-hidden>{m.emoji}</span>
          <span className="mood__label">{m.label}</span>
          <span className="mood__digit" aria-hidden>{m.digit}</span>
        </button>
      ))}
    </div>
  );
}
