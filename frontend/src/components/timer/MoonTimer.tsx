// The Start screen's one picture: a smiling moon with a toothbrush rocket on its orbit.
// While brushing, the rocket flies one lap in two minutes, leaving an aqua trail, and the
// moon's face turns to watch it. The four orbit dots light up at each 30 s quadrant.
const C = 160;
const ORBIT = 136;
const LAP = 2 * Math.PI * ORBIT;
const QUADRANTS = [0.25, 0.5, 0.75, 1];

export type MoonState = "parked" | "flying" | "done";

const LABELS: Record<MoonState, string> = {
  parked: "A smiling moon with a toothbrush rocket parked on its orbit",
  flying: "A toothbrush rocket flying around the moon",
  done: "The toothbrush rocket is back where it started and the moon is grinning",
};

export function MoonTimer({ progress, state }: { progress: number; state: MoonState }) {
  const p = Math.max(0, Math.min(1, progress));
  const angle = -90 + p * 360; // clockwise from 12 o'clock
  const rad = (angle * Math.PI) / 180;
  const rocketX = C + ORBIT * Math.cos(rad);
  const rocketY = C + ORBIT * Math.sin(rad);
  const look = state === "flying" ? 7 : 0;

  return (
    <svg className="moon" viewBox="0 0 320 320" role="img" aria-label={LABELS[state]}>
      {/* orbit, trail, quadrant dots */}
      <circle cx={C} cy={C} r={ORBIT} fill="none" stroke="#3A3A44" strokeWidth="3" strokeDasharray="1 11" strokeLinecap="round" />
      {p > 0 && (
        <circle
          cx={C} cy={C} r={ORBIT} fill="none" stroke="#6FE0E8" strokeWidth="6" strokeLinecap="round"
          strokeDasharray={LAP} strokeDashoffset={LAP * (1 - p)} transform={`rotate(-90 ${C} ${C})`}
        />
      )}
      {QUADRANTS.map((q) => {
        const a = ((-90 + q * 360) * Math.PI) / 180;
        return (
          <circle key={q} cx={C + ORBIT * Math.cos(a)} cy={C + ORBIT * Math.sin(a)} r="5"
            fill={p >= q ? "#6FE0E8" : "#3A3A44"} />
        );
      })}

      {/* the moon */}
      <circle cx={C} cy={C} r="90" fill="#FFE27A" />
      <circle cx="196" cy="116" r="15" fill="#F2C94C" />
      <circle cx="124" cy="112" r="9" fill="#F2C94C" />
      <circle cx="204" cy="204" r="11" fill="#F2C94C" />
      <circle cx="118" cy="210" r="6" fill="#F2C94C" />
      <g transform={`translate(${look * Math.cos(rad)} ${look * Math.sin(rad)})`}>
        <ellipse cx="122" cy="180" rx="11" ry="6" fill="#F272D8" opacity="0.5" />
        <ellipse cx="198" cy="180" rx="11" ry="6" fill="#F272D8" opacity="0.5" />
        <circle cx="140" cy="160" r="8.5" fill="#17171C" />
        <circle cx="180" cy="160" r="8.5" fill="#17171C" />
        {state === "done" ? (
          <path d="M142 180 Q160 206 178 180 Z" fill="#17171C" stroke="#17171C" strokeWidth="4" strokeLinejoin="round" />
        ) : (
          <path d="M146 182 Q160 194 174 182" stroke="#17171C" strokeWidth="5" fill="none" strokeLinecap="round" />
        )}
      </g>

      {/* the toothbrush rocket, drawn nose-right with bristles facing away from the moon */}
      <g transform={`translate(${rocketX} ${rocketY}) rotate(${angle + 90})`}>
        <g className={state === "flying" ? undefined : "moon__rocket--parked"}>
          {state === "flying" && (
            <path d="M-60 -5 H-70 M-58 5 H-76" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" opacity="0.45" />
          )}
          <path d="M-22 -8 Q-38 -12 -52 -6 Q-44 0 -52 6 Q-38 12 -22 8 Z" fill="#F272D8" />
          <path d="M-22 -4.5 Q-32 -6 -40 -3 Q-35 0 -40 3 Q-32 6 -22 4.5 Z" fill="#FFE27A" />
          <rect x="15" y="-17" width="4.5" height="12" rx="2.2" fill="#6FE0E8" />
          <rect x="21" y="-18" width="4.5" height="13" rx="2.2" fill="#6FE0E8" />
          <rect x="27" y="-17" width="4.5" height="12" rx="2.2" fill="#6FE0E8" />
          <rect x="33" y="-18" width="4.5" height="13" rx="2.2" fill="#6FE0E8" />
          <rect x="-26" y="-7" width="64" height="14" rx="7" fill="#FFFFFF" />
          <rect x="-8" y="-7" width="6" height="14" fill="#FFE27A" />
          <rect x="1" y="-7" width="3" height="14" fill="#F272D8" />
        </g>
      </g>
    </svg>
  );
}
