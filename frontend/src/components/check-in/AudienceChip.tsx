import { Icon } from "../icons/Icon";

export function AudienceChip({ label, onOpen }: { label: string; onOpen: () => void }) {
  return (
    <button className="audience-chip" onClick={onOpen} aria-haspopup="dialog">
      <span className="visually-hidden">Sending to </span>
      <span className="audience-chip__label">{label}</span>
      <Icon name="chevron-down" size={18} />
    </button>
  );
}
