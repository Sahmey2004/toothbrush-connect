// The brush timer is the moon. It waxes from new to full over the 2:00 session, lit from the
// right-hand limb with a true terminator curve. A capsule travels the orbit ring as time passes;
// four ticks mark the quadrant cues (FR-W4), each paired with a caption change and a glow pulse.
import { useEffect, useId, useState } from "react";
import { formatClock } from "../../hooks/useCountdown";
import { useReducedMotion } from "../../hooks/useReducedMotion";

export type MoonMode = "idle" | "active" | "done";

const TOTAL = 120_000;
const C = 116; // viewBox centre (232 × 232); the halo spills outside it
const R = 100; // moon radius
const ORBIT = 108;

export const PHASES = [
  { name: "New moon", spoken: "New moon, two minutes left" },
  { name: "Crescent", spoken: "Crescent, one and a half minutes left" },
  { name: "Half moon", spoken: "Half moon, one minute left" },
  { name: "Gibbous", spoken: "Gibbous, thirty seconds left" },
  { name: "Done", spoken: "Full moon. Done." },
];

// Lit region for illuminated fraction p (0 new … 1 full). For 0 < p < 1 the terminator is a
// half-ellipse with rx = R·|1 − 2p|, so the lit area is exactly p of the disc.
function litPath(p: number) {
  if (p <= 0.001) return "";
  if (p >= 0.999) return `M${C},${C - R} A${R},${R} 0 1,1 ${C - 0.01},${C - R} Z`;
  const rx = (R * Math.abs(1 - 2 * p)).toFixed(2);
  return `M${C},${C - R} A${R},${R} 0 0,1 ${C},${C + R} A${rx},${R} 0 0,${p < 0.5 ? 0 : 1} ${C},${C - R} Z`;
}

const CRATERS = [
  { x: 149, y: 83, r: 13 },
  { x: 167, y: 131, r: 8 },
  { x: 131, y: 161, r: 16 },
  { x: 87, y: 109, r: 11 },
  { x: 101, y: 63, r: 6 },
];

export function BrushMoon({
  elapsedMs, mode = "active", caption, size,
}: { elapsedMs: number; mode?: MoonMode; caption?: string; size?: number }) {
  const id = useId().replace(/:/g, "");
  const reduced = useReducedMotion();
  const clamped = Math.max(0, Math.min(TOTAL, elapsedMs));
  const quadrant = mode === "done" ? 4 : mode === "idle" ? 0 : Math.min(3, Math.floor(clamped / 30_000));
  // Reduced motion: the moon changes in discrete quarter steps, crossfaded; otherwise it waxes smoothly.
  const p = mode === "done" ? 1 : mode === "idle" ? 0 : reduced ? quadrant / 4 : clamped / TOTAL;
  const angle = 360 * p;
  const phase = PHASES[quadrant];
  const remaining = mode === "done" ? 0 : TOTAL - clamped;

  // Announce each phase change once, politely.
  const [spoken, setSpoken] = useState("");
  useEffect(() => {
    if (mode === "active" && quadrant > 0) setSpoken(phase.spoken);
    if (mode === "done") setSpoken(PHASES[4].spoken);
  }, [mode, quadrant, phase.spoken]);

  const label = mode === "idle" ? "Brush timer, two minutes, not started"
    : mode === "done" ? "Brush timer, full moon, done"
    : `Brush timer, ${phase.name.toLowerCase()}, ${formatClock(remaining)} left`;
  const d = litPath(p);

  return (
    <div className={`moon moon--${mode}${reduced ? " moon--reduced" : ""}`} style={size ? { ["--moon-size" as string]: `${size}px` } : undefined}>
      <div className="moon__stage" role="timer" aria-label={label}>
        <svg viewBox="0 0 232 232" aria-hidden="true" focusable="false">
          <defs>
            <radialGradient id={`halo-${id}`}>
              <stop offset="0.66" style={{ stopColor: "var(--moon-glow-solid)", stopOpacity: 0.5 }} />
              <stop offset="1" style={{ stopColor: "var(--moon-glow-solid)", stopOpacity: 0 }} />
            </radialGradient>
            <radialGradient id={`lit-${id}`} cx="0.62" cy="0.38" r="0.75">
              <stop offset="0" style={{ stopColor: "var(--moon-hi)" }} />
              <stop offset="0.6" style={{ stopColor: "var(--moon-surface)" }} />
              <stop offset="1" style={{ stopColor: "var(--moon-edge)" }} />
            </radialGradient>
            <clipPath id={`clip-${id}`}><path d={d} /></clipPath>
          </defs>

          <circle className="moon__halo" cx={C} cy={C} r={152} fill={`url(#halo-${id})`} style={{ opacity: 0.2 + 0.8 * p }} />
          <circle className="moon__orbit" cx={C} cy={C} r={ORBIT} />
          {[0, 90, 180, 270].map((deg, i) => (
            <line key={deg} className={`moon__tick${mode !== "idle" && quadrant >= i + 1 ? " is-passed" : ""}`}
              x1={C} y1={C - ORBIT - 5} x2={C} y2={C - ORBIT + 5} transform={`rotate(${deg} ${C} ${C})`} />
          ))}

          <circle className="moon__disc" cx={C} cy={C} r={R} />
          <g className="moon__craters moon__craters--dark">
            {CRATERS.map((c) => <circle key={c.x} cx={c.x} cy={c.y} r={c.r} />)}
          </g>
          <g key={reduced ? quadrant : "smooth"} className="moon__lit">
            <path d={d} fill={`url(#lit-${id})`} />
            <g clipPath={`url(#clip-${id})`} className="moon__craters">
              {CRATERS.map((c) => <circle key={c.x} cx={c.x} cy={c.y} r={c.r} />)}
            </g>
          </g>
          <circle className="moon__rim" cx={C} cy={C} r={R} />

          {mode !== "done" && (
            <g className="moon__craft" transform={`rotate(${angle.toFixed(2)} ${C} ${C})`}>
              {/* A capsule on the orbit, nose pointing along its path (clockwise). */}
              <g transform={`translate(${C} ${C - ORBIT}) rotate(90)`}>
                <path d="M0 -8c3 2.2 4.4 5.2 4.4 8.8V4H-4.4V.8C-4.4 -2.8 -3 -5.8 0 -8z" />
                <path d="M-2.6 4h5.2l-.9 2.4h-3.4z" className="moon__craft-flame" />
              </g>
            </g>
          )}
        </svg>
        {mode !== "idle" && <span key={quadrant} className="moon__pulse" aria-hidden="true" />}
      </div>
      <p className="moon__readout">
        <span className="moon__caption" key={`cap-${quadrant}-${mode}`}>{caption ?? (mode === "idle" ? "Ready for liftoff." : phase.name)}</span>
        {mode === "active" && <span className="moon__time">{formatClock(remaining)}</span>}
      </p>
      <p className="visually-hidden" aria-live="polite">{spoken}</p>
    </div>
  );
}
