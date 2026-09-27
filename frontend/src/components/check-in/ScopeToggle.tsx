import type { Scope } from "../../types/moods";

// FR-C2: Today (default) or This week. `compact` shortens the labels when "Add a line" is open.
export function ScopeToggle({ value, onChange, compact = false }: { value: Scope; onChange: (s: Scope) => void; compact?: boolean }) {
  return (
    <div className="segmented" role="radiogroup" aria-label="Update covers">
      {(["today", "this_week"] as const).map((s) => (
        <button key={s} role="radio" aria-checked={value === s} className={value === s ? "is-on" : ""} onClick={() => onChange(s)}>
          {s === "today" ? "Today" : compact ? <>Week<span className="visually-hidden"> (this week)</span></> : "This week"}
        </button>
      ))}
    </div>
  );
}
