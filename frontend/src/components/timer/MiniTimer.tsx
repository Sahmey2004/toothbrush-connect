import { useBrush } from "../../brush/BrushContext";
import { formatClock, useCountdown } from "../../hooks/useCountdown";

// The brushing countdown, pinned to the top of the pop app after you send. It runs its own
// countdown so only this bar repaints each frame — and it vanishes the moment the session ends.
const TOTAL_MS = 120_000;
const R = 11;
const CIRC = 2 * Math.PI * R;

export function MiniTimer() {
  const { session, end } = useBrush();
  const remaining = useCountdown(session?.ends_at ?? null);
  if (!session) return null;

  const p = Math.min(1, Math.max(0, 1 - remaining / TOTAL_MS));
  return (
    <div className="pop-brushbar" role="timer" aria-label={`Brushing, ${formatClock(remaining)} left`}>
      <svg className="pop-brushbar__ring" width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
        <circle cx="14" cy="14" r={R} fill="none" stroke="#3a3a44" strokeWidth="3" />
        <circle cx="14" cy="14" r={R} fill="none" stroke="#6FE0E8" strokeWidth="3" strokeLinecap="round"
          strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - p)} transform="rotate(-90 14 14)" />
      </svg>
      <span className="pop-brushbar__clock">{formatClock(remaining)}</span>
      <span className="pop-brushbar__label">brushing</span>
      <button type="button" className="pop-brushbar__end" onClick={() => end()}>End</button>
    </div>
  );
}
