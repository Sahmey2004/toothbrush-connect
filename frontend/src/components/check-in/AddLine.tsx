import { useState } from "react";

// FR-C3: optional line, up to 140 characters.
export function AddLine({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(value.length > 0);
  if (!open) {
    return <button className="add-line__open" onClick={() => setOpen(true)}>Add a line</button>;
  }
  return (
    <label className="add-line">
      <span className="visually-hidden">A line for your friends</span>
      <input
        autoFocus
        maxLength={140}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="moving apartments send help"
      />
      <span className={`add-line__count${value.length > 120 ? " is-near" : ""}`}>{140 - value.length}</span>
    </label>
  );
}
