import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Audience, CircleMember, FriendList } from "../../types/api";
import { Avatar } from "../common/Avatar";
import { Icon } from "../icons/Icon";

interface Props {
  open: boolean;
  initial: Audience;
  friends: Pick<CircleMember, "friend_id" | "display_name">[];
  lists: FriendList[];
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: (a: Audience, makeDefault: boolean) => void;
}

// FR-R2 / FR-R3: bottom-sheet picker. Saved lists on top, friends below, every row ≥ 56px with a
// round control, a "Make default" switch and Done pinned to the bottom. Rendered inside the
// screen (not the browser's top layer) so it stays within the thumb zone and the safe area.
export function AudienceSheet({ open, initial, friends, lists, confirmLabel = "Done", onClose, onConfirm }: Props) {
  const [choice, setChoice] = useState<Audience>(initial);
  const [makeDefault, setMakeDefault] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    setChoice(initial);
    setMakeDefault(false);
    returnTo.current = document.activeElement;
    sheetRef.current?.querySelector<HTMLElement>(".pick")?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      (returnTo.current as HTMLElement | null)?.focus?.();
    };
    // Reset only when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const picked = choice.type === "custom" ? choice.friendIds ?? [] : [];
  const toggleFriend = (id: string) => {
    const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
    setChoice(next.length ? { type: "custom", friendIds: next } : { type: "everyone" });
  };
  const canDefault = choice.type !== "custom";

  const row = (key: string, on: boolean, onClick: () => void, lead: ReactNode, title: string, sub?: string) => (
    <PickRow key={key} on={on} onClick={onClick} lead={lead} title={title} sub={sub} />
  );

  return (
    <div className="sheet-layer">
      <div className="sheet-layer__scrim" onClick={onClose} aria-hidden="true" />
      <div ref={sheetRef} className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
        <button className="sheet__grab" onClick={onClose} aria-label="Close"><span /></button>
        <h2 id="sheet-title" className="sheet__title">Who sees this?</h2>
        <div className="sheet__scroll">
          <h3 className="sheet__sub">Saved lists</h3>
          {row("everyone", choice.type === "everyone", () => setChoice({ type: "everyone" }),
            <span className="pick__glyph"><Icon name="everyone" size={20} /></span>, "Everyone", `All ${friends.length} friends`)}
          {lists.map((l) => row(l.id, choice.type === "list" && choice.listId === l.id, () => setChoice({ type: "list", listId: l.id }),
            <span className="pick__glyph"><Icon name="lists" size={20} /></span>, l.name,
            l.members.map((id) => friends.find((f) => f.friend_id === id)?.display_name).filter(Boolean).join(", ") || `${l.members.length} friends`))}
          {friends.length > 0 && <h3 className="sheet__sub">Friends</h3>}
          {friends.map((f) => row(f.friend_id, picked.includes(f.friend_id), () => toggleFriend(f.friend_id),
            <Avatar id={f.friend_id} name={f.display_name} size={36} />, f.display_name || "Guest friend"))}
        </div>
        <div className="sheet__foot">
          <button className={`switch-row${canDefault ? "" : " is-disabled"}`} role="switch" aria-checked={makeDefault && canDefault}
            disabled={!canDefault} onClick={() => setMakeDefault(!makeDefault)}>
            <span>Make default</span>
            <span className="switch" aria-hidden="true"><span /></span>
          </button>
          <button className="btn btn--primary btn--big" onClick={() => onConfirm(choice, makeDefault && canDefault)}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

// One ≥ 56px row: circular avatar or glyph, name, and a round selection control.
export function PickRow({ on, onClick, lead, title, sub }: { on: boolean; onClick: () => void; lead: ReactNode; title: string; sub?: string }) {
  return (
    <button className={`pick${on ? " is-on" : ""}`} onClick={onClick} aria-pressed={on}>
      {lead}
      <span className="pick__body"><span className="pick__title">{title}</span>{sub && <span className="pick__sub">{sub}</span>}</span>
      <span className="pick__radio" aria-hidden="true" />
    </button>
  );
}
