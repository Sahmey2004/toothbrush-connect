import { Icon } from "../icons/Icon";

// FR-W3: the whole bottom of the idle screen is one Start target, a moonbeam-gold launch pad.
export function StartButton({ onStart, busy, friendsBrushing }: { onStart: () => void; busy: boolean; friendsBrushing: string[] }) {
  const hint = friendsBrushing.length === 0 ? "Two minutes, one update, your people"
    : friendsBrushing.length === 1 ? `${friendsBrushing[0]} is brushing now`
    : `${friendsBrushing.length} friends are brushing now`;
  return (
    <button className="launch" onClick={onStart} disabled={busy}>
      <span className="launch__icon"><Icon name="arc-up" size={28} /></span>
      <span className="launch__title">{busy ? "Starting…" : "Start brushing"}</span>
      <span className="launch__hint">{hint}</span>
    </button>
  );
}
