// FR-T3: one tap anywhere in the bottom of the screen starts a session.
export function StartButton({ onStart, busy, friendsBrushing }: { onStart: () => void; busy: boolean; friendsBrushing: number }) {
  return (
    <button className="start" onClick={onStart} disabled={busy}>
      <span className="start__icon" aria-hidden>🪥</span>
      <span className="start__title">{busy ? "Starting…" : "Start brushing"}</span>
      <span className="start__hint">
        {friendsBrushing > 0
          ? `${friendsBrushing} ${friendsBrushing === 1 ? "friend is" : "friends are"} brushing now`
          : "Two minutes, one update, your people"}
      </span>
    </button>
  );
}
