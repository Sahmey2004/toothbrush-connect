import type { Scope } from "../../types/moods";

export function ScopeToggle({ value, onChange }: { value: Scope; onChange: (s: Scope) => void }) {
  return (
    <div className="segmented" role="radiogroup" aria-label="Update covers">
      {(["today", "this_week"] as const).map((s) => (
        <button key={s} role="radio" aria-checked={value === s} className={value === s ? "is-on" : ""} onClick={() => onChange(s)}>
          {s === "today" ? "Today" : "This week"}
        </button>
      ))}
    </div>
  );
}
