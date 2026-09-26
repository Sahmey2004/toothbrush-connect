import { useEffect, useRef, useState } from "react";
import type { Audience, CircleMember, FriendList } from "../../types/api";

interface Props {
  open: boolean;
  initial: Audience;
  friends: CircleMember[];
  lists: FriendList[];
  confirmLabel: string;
  onClose: () => void;
  onConfirm: (a: Audience, makeDefault: boolean) => void;
}

// FR-R3 / FR-R9: bottom-sheet picker. Lists are lettered like the text picker; friends are numbered.
export function AudienceSheet({ open, initial, friends, lists, confirmLabel, onClose, onConfirm }: Props) {
  const [choice, setChoice] = useState<Audience>(initial);
  const [makeDefault, setMakeDefault] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setChoice(initial);
      setMakeDefault(false);
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open, initial]);

  const picked = choice.type === "custom" ? choice.friendIds ?? [] : [];
  const toggleFriend = (id: string) => {
    const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
    setChoice(next.length ? { type: "custom", friendIds: next } : { type: "everyone" });
  };
  const canDefault = choice.type !== "custom";

  return (
    <dialog ref={ref} className="sheet" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      <div className="sheet__body">
        <h2 className="sheet__title">Who sees this?</h2>
        <div className="sheet__scroll">
          <button className={`pick${choice.type === "everyone" ? " is-on" : ""}`} onClick={() => setChoice({ type: "everyone" })}>
            <span className="pick__key">*</span> Everyone <span className="pick__meta">{friends.length}</span>
          </button>
          {lists.map((l) => (
            <button key={l.id} className={`pick${choice.type === "list" && choice.listId === l.id ? " is-on" : ""}`}
              onClick={() => setChoice({ type: "list", listId: l.id })}>
              <span className="pick__key">{l.letter}</span> {l.name} <span className="pick__meta">{l.members.length}</span>
            </button>
          ))}
          {friends.length > 0 && <h3 className="sheet__sub">Or pick friends</h3>}
          {friends.map((f, i) => (
            <button key={f.friend_id} className={`pick${picked.includes(f.friend_id) ? " is-on" : ""}`}
              onClick={() => toggleFriend(f.friend_id)} aria-pressed={picked.includes(f.friend_id)}>
              <span className="pick__key">{i + 1}</span> {f.display_name || "Guest friend"}
            </button>
          ))}
        </div>
        <label className={`sheet__default${canDefault ? "" : " is-disabled"}`}>
          <input type="checkbox" checked={makeDefault && canDefault} disabled={!canDefault}
            onChange={(e) => setMakeDefault(e.target.checked)} />
          Make this my default
        </label>
        <div className="sheet__actions">
          <button className="btn btn--quiet" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={() => onConfirm(choice, makeDefault && canDefault)}>{confirmLabel}</button>
        </div>
      </div>
    </dialog>
  );
}
