export function AudienceChip({ label, onOpen }: { label: string; onOpen: () => void }) {
  return (
    <button className="audience-chip" onClick={onOpen} aria-haspopup="dialog">
      <span className="audience-chip__prefix">Sending to</span> {label} <span aria-hidden>▾</span>
    </button>
  );
}
