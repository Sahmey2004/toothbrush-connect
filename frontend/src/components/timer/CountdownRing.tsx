import { formatClock } from "../../hooks/useCountdown";

// The toothpaste ring: three stripes (mint gel, white, deep teal) squeezed out as the 2:00 runs down.
const SIZE = 260;
const C = SIZE / 2;
const STRIPES = [
  { r: 112, w: 18, cls: "ring__stripe--mint" },
  { r: 97, w: 8, cls: "ring__stripe--white" },
  { r: 88, w: 6, cls: "ring__stripe--ink" },
];

export function CountdownRing({ remainingMs, totalMs = 120_000 }: { remainingMs: number; totalMs?: number }) {
  const fraction = Math.max(0, Math.min(1, remainingMs / totalMs));
  const quadrant = Math.min(4, Math.floor((1 - fraction) * 4) + 1);
  return (
    <div className="ring" role="timer" aria-label={`${formatClock(remainingMs)} left, quadrant ${quadrant} of 4`}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden>
        {STRIPES.map((s) => {
          const len = 2 * Math.PI * s.r;
          return (
            <g key={s.r}>
              <circle className="ring__track" cx={C} cy={C} r={s.r} strokeWidth={s.w} />
              <circle
                className={`ring__stripe ${s.cls}`}
                cx={C} cy={C} r={s.r} strokeWidth={s.w}
                strokeDasharray={len}
                strokeDashoffset={len * (1 - fraction)}
                transform={`rotate(-90 ${C} ${C})`}
              />
            </g>
          );
        })}
        {[0, 90, 180, 270].map((deg) => (
          <line key={deg} className="ring__tick" x1={C} y1={4} x2={C} y2={14} transform={`rotate(${deg} ${C} ${C})`} />
        ))}
      </svg>
      <div className="ring__readout">
        <span className="ring__clock">{formatClock(remainingMs)}</span>
        <span className="ring__quadrant">
          {["Top left", "Top right", "Bottom left", "Bottom right"][quadrant - 1]}
        </span>
      </div>
    </div>
  );
}
