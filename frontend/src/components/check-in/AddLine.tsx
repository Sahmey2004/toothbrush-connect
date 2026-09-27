import { useState } from "react";
import { Icon } from "../icons/Icon";

const MAX = 140;

// FR-C3: optional line, up to 140 characters, with a visible counter.
export function AddLine({ value, onChange, open: forceOpen }: { value: string; onChange: (v: string) => void; open?: boolean }) {
  const [open, setOpen] = useState(forceOpen ?? value.length > 0);
  const [tapped, setTapped] = useState(false); // focus only when the person opened it
  if (!open) {
    return (
      <button className="text-btn add-line__open" onClick={() => { setOpen(true); setTapped(true); }}>
        <Icon name="plus" size={18} />Add a line
      </button>
    );
  }
  return (
    <label className="add-line">
      <span className="visually-hidden">A line for your friends, up to {MAX} characters</span>
      <input
        autoFocus={tapped}
        maxLength={MAX}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="moving apartments, send help"
        enterKeyHint="done"
      />
      <span className={`add-line__count${value.length > 120 ? " is-near" : ""}`} aria-live="polite">{value.length}/{MAX}</span>
    </label>
  );
}
