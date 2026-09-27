// "Fly me to the moon" in the pop identity: the crew's toothbrush rocket flies from Earth to a
// smiling moon. Every update anyone in the crew posts adds fuel; your update fires the engine.
// Skip a day and the rocket just waits: nothing drains, nothing resets.
import { Link } from "react-router-dom";
import { flightPath } from "../../lib/flightPath";
import {
  KM_PER_UPDATE, MILESTONES, MOON_KM, formatKm, nextMilestone,
  type CrewMember, type Journey,
} from "../../lib/journey";
import "../../styles/journey.css";

// ── The scene ───────────────────────────────────────────────────────────────────────────────

const MOON = { x: 262, y: 84, r: 50 };
const PATH = flightPath([[98, 262], [64, 148], [236, 214], [220, 122]]);

// The toothbrush rocket from the timer, drawn nose-right: bristles up front, flame behind.
function ToothbrushRocket({ firing }: { firing: boolean }) {
  return (
    <g className={firing ? "pj-rocket is-firing" : "pj-rocket"}>
      {firing && (
        <>
          <path d="M-60 -5 H-70 M-58 5 H-76" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" opacity="0.45" />
          <path className="pj-rocket__flame" d="M-22 -8 Q-38 -12 -52 -6 Q-44 0 -52 6 Q-38 12 -22 8 Z" fill="#F272D8" />
          <path className="pj-rocket__flame" d="M-22 -4.5 Q-32 -6 -40 -3 Q-35 0 -40 3 Q-32 6 -22 4.5 Z" fill="#FFE27A" />
        </>
      )}
      <rect x="15" y="-17" width="4.5" height="12" rx="2.2" fill="#6FE0E8" />
      <rect x="21" y="-18" width="4.5" height="13" rx="2.2" fill="#6FE0E8" />
      <rect x="27" y="-17" width="4.5" height="12" rx="2.2" fill="#6FE0E8" />
      <rect x="33" y="-18" width="4.5" height="13" rx="2.2" fill="#6FE0E8" />
      <rect x="-26" y="-7" width="64" height="14" rx="7" fill="#FFFFFF" />
      <rect x="-8" y="-7" width="6" height="14" fill="#FFE27A" />
      <rect x="1" y="-7" width="3" height="14" fill="#F272D8" />
    </g>
  );
}

// Touchdown: the moon opens wide, eyes shut in a happy squint, showing its teeth.
const MOUTH = `M${MOON.x - 20} ${MOON.y + 8} Q${MOON.x} ${MOON.y + 44} ${MOON.x + 20} ${MOON.y + 8} Z`;
function MoonBrushing() {
  return (
    <g>
      <ellipse cx={MOON.x - 27} cy={MOON.y + 8} rx="7" ry="4" fill="#F272D8" opacity="0.5" />
      <ellipse cx={MOON.x + 27} cy={MOON.y + 8} rx="7" ry="4" fill="#F272D8" opacity="0.5" />
      <path d={`M${MOON.x - 19} ${MOON.y - 4} Q${MOON.x - 13} ${MOON.y - 11} ${MOON.x - 7} ${MOON.y - 4} M${MOON.x + 7} ${MOON.y - 4} Q${MOON.x + 13} ${MOON.y - 11} ${MOON.x + 19} ${MOON.y - 4}`}
        stroke="#17171C" strokeWidth="4" fill="none" strokeLinecap="round" />
      <defs><clipPath id="pj-mouth"><path d={MOUTH} /></clipPath></defs>
      <path d={MOUTH} fill="#17171C" stroke="#17171C" strokeWidth="3" strokeLinejoin="round" />
      <g clipPath="url(#pj-mouth)">
        <ellipse cx={MOON.x} cy={MOON.y + 27} rx="10" ry="6" fill="#F272D8" />
        <rect x={MOON.x - 22} y={MOON.y + 6} width="44" height="11" fill="#FFFFFF" />
        <path d={`M${MOON.x - 7} ${MOON.y + 8} V${MOON.y + 17} M${MOON.x + 7} ${MOON.y + 8} V${MOON.y + 17}`} stroke="#D5D8DE" strokeWidth="1.5" />
      </g>
      <path className="pj-shine" d={`M${MOON.x + 12} ${MOON.y + 5} Q${MOON.x + 12} ${MOON.y + 10} ${MOON.x + 17} ${MOON.y + 10} Q${MOON.x + 12} ${MOON.y + 10} ${MOON.x + 12} ${MOON.y + 15} Q${MOON.x + 12} ${MOON.y + 10} ${MOON.x + 7} ${MOON.y + 10} Q${MOON.x + 12} ${MOON.y + 10} ${MOON.x + 12} ${MOON.y + 5} Z`} fill="#FFFFFF" />
    </g>
  );
}

// The rocket flies in, then scrubs the moon's teeth, bristles up, handle sticking out of its mouth.
const BUBBLES = [
  { dx: 16, dy: 6, r: 4, delay: 0 },
  { dx: 26, dy: 16, r: 3, delay: 0.5 },
  { dx: 4, dy: 2, r: 5, delay: 0.9 },
  { dx: 32, dy: 2, r: 3.5, delay: 1.3 },
  { dx: -6, dy: 8, r: 3, delay: 1.7 },
];
function BrushDock() {
  return (
    <g>
      <g transform={`translate(${MOON.x - 22} ${MOON.y + 32}) scale(0.85)`}>
        <g className="pj-dock">
          <g className="pj-scrub"><ToothbrushRocket firing={false} /></g>
        </g>
      </g>
      {BUBBLES.map((b, i) => (
        <circle key={i} className="pj-bubble" cx={MOON.x + b.dx} cy={MOON.y + b.dy} r={b.r}
          fill="#FFFFFF" fillOpacity="0.85" stroke="#6FE0E8" strokeWidth="1.5" style={{ animationDelay: `${1 + b.delay}s` }} />
      ))}
    </g>
  );
}

export function PopFlightScene({ j, celebrating = false }: { j: Journey; celebrating?: boolean }) {
  const p = j.km / MOON_KM;
  const holding = !j.postedToday;
  const rocket = PATH.at(p);
  const ghostP = Math.min(1, (j.km + j.tankKm + KM_PER_UPDATE) / MOON_KM);
  const ghost = PATH.at(ghostP);
  const next = nextMilestone(j.km);
  // The moon's eyes follow the rocket.
  const dx = rocket.x - MOON.x, dy = rocket.y - MOON.y, d = Math.hypot(dx, dy) || 1;
  const look = { x: (dx / d) * 5, y: (dy / d) * 5 };
  const arrived = p >= 1;
  const label = arrived ? "The toothbrush rocket landed on the moon and is brushing its teeth." : `Toothbrush rocket at ${formatKm(j.km)} of ${formatKm(MOON_KM)}, ${Math.round(p * 100)} percent of the way to the moon, ${holding ? "waiting for your update" : "flying"}.`;

  return (
    <svg className="pj-scene__svg" viewBox="0 0 340 330" role="img" aria-label={label}>
      {/* stars */}
      <circle cx="40" cy="60" r="2.5" fill="#FFFFFF" opacity="0.7" />
      <circle cx="150" cy="36" r="2" fill="#FFFFFF" opacity="0.6" />
      <circle cx="312" cy="190" r="2.5" fill="#FFFFFF" />
      <circle cx="190" cy="300" r="2" fill="#FFFFFF" opacity="0.5" />
      <circle cx="300" cy="286" r="4" fill="#6FE0E8" />
      <path d="M92 86 Q92 96 102 96 Q92 96 92 106 Q92 96 82 96 Q92 96 92 86 Z" fill="#FFE27A" />
      <path d="M300 236 Q300 244 308 244 Q300 244 300 252 Q300 244 292 244 Q300 244 300 236 Z" fill="#F272D8" />

      {/* smiling moon */}
      <circle cx={MOON.x} cy={MOON.y} r={MOON.r} fill="#FFE27A" />
      <circle cx={MOON.x + 24} cy={MOON.y - 24} r="9" fill="#F2C94C" />
      <circle cx={MOON.x - 26} cy={MOON.y - 22} r="6" fill="#F2C94C" />
      <circle cx={MOON.x + 28} cy={MOON.y + 22} r="7" fill="#F2C94C" />
      {arrived ? <MoonBrushing /> : (
      <g transform={`translate(${look.x.toFixed(1)} ${look.y.toFixed(1)})`}>
        <ellipse cx={MOON.x - 24} cy={MOON.y + 14} rx="7" ry="4" fill="#F272D8" opacity="0.5" />
        <ellipse cx={MOON.x + 24} cy={MOON.y + 14} rx="7" ry="4" fill="#F272D8" opacity="0.5" />
        <circle cx={MOON.x - 12} cy={MOON.y} r="5.5" fill="#17171C" />
        <circle cx={MOON.x + 12} cy={MOON.y} r="5.5" fill="#17171C" />
        {celebrating ? (
          <path d={`M${MOON.x - 11} ${MOON.y + 12} Q${MOON.x} ${MOON.y + 30} ${MOON.x + 11} ${MOON.y + 12} Z`} fill="#17171C" stroke="#17171C" strokeWidth="3" strokeLinejoin="round" />
        ) : holding ? (
          <circle cx={MOON.x} cy={MOON.y + 16} r="4" fill="#17171C" />
        ) : (
          <path d={`M${MOON.x - 9} ${MOON.y + 13} Q${MOON.x} ${MOON.y + 22} ${MOON.x + 9} ${MOON.y + 13}`} stroke="#17171C" strokeWidth="4" fill="none" strokeLinecap="round" />
        )}
      </g>
      )}

      {/* Earth, where the crew took off */}
      <circle cx="20" cy="372" r="118" fill="#6FE0E8" />
      <ellipse cx="18" cy="268" rx="30" ry="13" fill="#F272D8" />
      <ellipse cx="96" cy="300" rx="17" ry="9" fill="#F272D8" />

      {/* the trip: still to fly (dotted), what the fuel would add (yellow), flown (aqua) */}
      <polyline points={PATH.trail(p, 1)} fill="none" stroke="#3A3A44" strokeWidth="3" strokeDasharray="1 11" strokeLinecap="round" />
      {holding && ghostP > p && (
        <polyline className="pj-ghost" points={PATH.trail(p, ghostP)} fill="none" stroke="#FFE27A" strokeWidth="5" strokeDasharray="2 9" strokeLinecap="round" />
      )}
      <polyline points={PATH.trail(0, p)} fill="none" stroke="#6FE0E8" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />

      {MILESTONES.slice(1, -1).map((m) => {
        const pt = PATH.at(m.km / MOON_KM);
        const passed = j.km >= m.km;
        const isNext = next?.km === m.km;
        return (
          <circle key={m.km} cx={pt.x} cy={pt.y} r={isNext ? 7 : 5}
            fill={passed ? "#6FE0E8" : isNext ? "#FFE27A" : "#3A3A44"}
            stroke={isNext ? "#141418" : "none"} strokeWidth="3" />
        );
      })}

      {holding && ghostP > p && (
        <g transform={`translate(${(ghost.x + 38).toFixed(1)} ${(ghost.y + 6).toFixed(1)})`}>
          <rect x="-26" y="-13" width="52" height="24" rx="12" fill="#FFE27A" />
          <text className="pj-ghost__label" x="0" y="4" textAnchor="middle">+{Math.round((j.tankKm + KM_PER_UPDATE) / 1000)}k</text>
        </g>
      )}

      {arrived ? <BrushDock /> : (
        <g transform={`translate(${rocket.x.toFixed(1)} ${rocket.y.toFixed(1)}) rotate(${rocket.heading.toFixed(1)}) scale(0.72)`}>
          <g className={holding ? "pj-rocket__bob" : undefined}><ToothbrushRocket firing={!holding} /></g>
        </g>
      )}
    </svg>
  );
}

// ── Cards ───────────────────────────────────────────────────────────────────────────────────

const joinNames = (n: string[]) => (n.length <= 1 ? n.join("") : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`);

function Seats({ crew, fuelers }: { crew: CrewMember[]; fuelers: string[] }) {
  return (
    <ul className="pj-seats" aria-label="Who added fuel today">
      {crew.map((c) => {
        const on = fuelers.includes(c.id);
        return (
          <li key={c.id} className={"pj-seat" + (on ? " is-on" : "") + (c.me ? " is-me" : "")}>
            <span className="pj-seat__avatar">
              {c.name[0].toUpperCase()}
              {on && <span className="pj-seat__fuel" aria-hidden="true">⛽</span>}
            </span>
            <span className="pj-seat__name">{c.me ? "You" : c.name}</span>
            <span className="visually-hidden">{on ? "added fuel" : "not yet"}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Status({ j, ctaTo }: { j: Journey; ctaTo: string }) {
  if (!j.postedToday) {
    return (
      <section className="pj-card" aria-labelledby="pj-status">
        <span className="pj-chip pj-chip--pink">⏸ Waiting on you</span>
        <h2 id="pj-status" className="pj-card__title">+{formatKm(j.tankKm + KM_PER_UPDATE)} ready</h2>
        <Seats crew={j.crew} fuelers={j.todayFuelers} />
        <Link className="pj-btn pj-btn--primary" to={ctaTo}>🚀 Brush and fire the engine</Link>
        <p className="pj-card__fine">Skipped days never reset.</p>
      </section>
    );
  }
  const today = j.week[j.week.length - 1];
  const waiting = j.crew.filter((c) => !c.me && !j.todayFuelers.includes(c.id));
  return (
    <section className="pj-card" aria-labelledby="pj-status">
      <span className="pj-chip pj-chip--yellow">{j.km >= MOON_KM ? "🌕 Landed" : "🔥 Flying"}</span>
      <h2 id="pj-status" className="pj-card__title">+{formatKm(today?.km ?? 0)} today!</h2>
      <Seats crew={j.crew} fuelers={j.todayFuelers} />
      {waiting.length > 0 && (
        <button type="button" className="pj-btn pj-btn--ghost">👋 Wave at {joinNames(waiting.map((w) => w.name))}</button>
      )}
    </section>
  );
}

// ── The page ────────────────────────────────────────────────────────────────────────────────

export function PopJourney({ j, ctaTo = "/start" }: { j: Journey; ctaTo?: string }) {
  const today = j.week[j.week.length - 1];
  const before = j.km - (j.postedToday ? today?.km ?? 0 : 0);
  const justReached = j.postedToday ? MILESTONES.find((m) => m.km > before && m.km <= j.km) : undefined;
  const pct = Math.round((j.km / MOON_KM) * 100);

  return (
    <div className="pj">
      <h1 className="pop-feed__title">Fly me to the moon</h1>

      <section className="pj-scene" aria-labelledby="pj-flight">
        <h2 id="pj-flight" className="visually-hidden">Flight path</h2>
        <PopFlightScene j={j} celebrating={!!justReached} />
        <div className="pj-scene__readout">
          {justReached && (
            <span className="pj-chip pj-chip--yellow" aria-live="polite">
              {justReached.km >= MOON_KM ? "🌕 Landed on the moon!" : `🎉 Passed ${justReached.name}`}
            </span>
          )}
          <p className="pj-scene__km">{formatKm(j.km)}</p>
          <div className="pj-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
          <p className="pj-scene__of">{pct}% to the moon</p>
        </div>
      </section>

      <Status j={j} ctaTo={ctaTo} />
    </div>
  );
}
