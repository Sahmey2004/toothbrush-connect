// "Fly me to the moon": the crew journey. A flight path from Earth to the Moon that the crew's
// updates push the rocket along. Pressure without punishment: skipping a day only pauses the
// rocket (fuel waits in the tank), and every burn and milestone is a visible reward.
import { Link } from "react-router-dom";
import {
  KM_PER_UPDATE, MILESTONES, MOON_KM, formatKm, nextMilestone, updatesTo,
  type CrewMember, type FlightDay, type Journey, type Milestone,
} from "../../lib/journey";
import { flightPath } from "../../lib/flightPath";
import { Avatar } from "../common/Avatar";
import { Icon, type IconName } from "../icons/Icon";

// ── The flight path ─────────────────────────────────────────────────────────────────────────

const W = 340;
const H = 380;
const P = [[74, 318], [0, 196], [340, 238], [258, 86]] as const; // cubic Bézier, Earth → Moon

const path = flightPath(P);
const trail = path.trail;
// The rocket is drawn nose-up, so turn it a further 90° from the path's heading.
const at = (fraction: number) => {
  const pt = path.at(fraction);
  return { ...pt, angle: pt.heading + 90 };
};

function Rocket({ firing }: { firing: boolean }) {
  return (
    <g className={`jrocket${firing ? " is-firing" : " is-holding"}`}>
      {firing && <path className="jrocket__flame" d="M-4.5 11 L4.5 11 L0 24 Z" />}
      <path className="jrocket__fin" d="M-7 2 L-13 11 L-13 14 L-7 11 Z M7 2 L13 11 L13 14 L7 11 Z" />
      <path className="jrocket__body" d="M0 -17 C6 -12 8 -5 8 3 L8 11 L-8 11 L-8 3 C-8 -5 -6 -12 0 -17 Z" />
      <circle className="jrocket__window" cx="0" cy="-3" r="3.2" />
    </g>
  );
}

export function FlightPath({ j, preview = true }: { j: Journey; preview?: boolean }) {
  const p = j.km / MOON_KM;
  const holding = !j.postedToday;
  const rocket = at(p);
  // While holding, show where the waiting fuel plus your own update would carry you.
  const ghostP = Math.min(1, (j.km + j.tankKm + KM_PER_UPDATE) / MOON_KM);
  const ghost = at(ghostP);
  const next = nextMilestone(j.km);
  const moonGlow = 0.25 + 0.75 * p;
  const label = `Rocket at ${formatKm(j.km)} of ${formatKm(MOON_KM)}, ${Math.round(p * 100)} percent of the way to the Moon, ${holding ? "holding" : "flying"}.`;

  return (
    <svg className="jpath" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <defs>
        <radialGradient id="jp-earth" cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#8fb8ff" />
          <stop offset="0.55" stopColor="#3f6fd8" />
          <stop offset="1" stopColor="#1d347f" />
        </radialGradient>
        <radialGradient id="jp-moonglow">
          <stop offset="0.5" style={{ stopColor: "var(--moon-glow-solid)", stopOpacity: 0.55 }} />
          <stop offset="1" style={{ stopColor: "var(--moon-glow-solid)", stopOpacity: 0 }} />
        </radialGradient>
      </defs>

      {/* Moon: it brightens as the crew gets closer. */}
      <circle cx={P[3][0] + 26} cy={P[3][1] - 34} r={70} fill="url(#jp-moonglow)" style={{ opacity: moonGlow }} />
      <g className="jpath__moon">
        <circle cx={P[3][0] + 26} cy={P[3][1] - 34} r={38} />
        <circle className="jpath__crater" cx={P[3][0] + 38} cy={P[3][1] - 46} r={8} />
        <circle className="jpath__crater" cx={P[3][0] + 14} cy={P[3][1] - 22} r={10} />
        <circle className="jpath__crater" cx={P[3][0] + 40} cy={P[3][1] - 18} r={5} />
      </g>

      {/* Earth, where the crew launched from. */}
      <g className="jpath__earth">
        <circle cx={P[0][0] - 16} cy={P[0][1] + 22} r={34} fill="url(#jp-earth)" />
        <path d={`M${P[0][0] - 38} ${P[0][1] + 12} q9 -10 19 -5 q7 5 15 0 q5 9 -3 14 q-12 3 -17 10 q-10 -3 -14 -19z`} fill="#7fd6b3" opacity="0.75" />
        <circle cx={P[0][0] - 16} cy={P[0][1] + 22} r={34} fill="none" stroke="#bcd3ff" strokeOpacity="0.35" strokeWidth="2" />
      </g>

      {/* Distance still to fly (dotted), then distance flown (solid gold). */}
      <polyline className="jpath__ahead" points={trail(p, 1)} />
      {holding && preview && ghostP > p && <polyline className="jpath__ghost" points={trail(p, ghostP)} />}
      <polyline className="jpath__flown" points={trail(0, p)} />

      {/* Milestones along the way. */}
      {MILESTONES.slice(1, -1).map((m) => {
        const pt = at(m.km / MOON_KM);
        const passed = j.km >= m.km;
        const isNext = next?.km === m.km;
        return (
          <g key={m.km}>
            <circle className={`jpath__stop${passed ? " is-passed" : ""}${isNext ? " is-next" : ""}`} cx={pt.x} cy={pt.y} r={isNext ? 6.5 : 5} />
            {isNext && !(holding && preview && Math.abs(ghostP - m.km / MOON_KM) < 0.1) && Math.abs(p - m.km / MOON_KM) > 0.06 && (
              <text className="jpath__stop-label" x={pt.x} y={pt.y + 24} textAnchor="middle">
                {m.name}
              </text>
            )}
          </g>
        );
      })}

      {holding && preview && ghostP > p && (
        <g className="jpath__ghost-dot">
          <circle cx={ghost.x} cy={ghost.y} r={9} />
          <text x={ghost.x} y={ghost.y - 15} textAnchor="middle">+{Math.round((j.tankKm + KM_PER_UPDATE) / 1000)}k</text>
        </g>
      )}

      <g transform={`translate(${rocket.x.toFixed(1)} ${rocket.y.toFixed(1)}) rotate(${rocket.angle.toFixed(1)})`}>
        {holding && <circle className="jrocket__hold-ring" r={21} />}
        <g className="jrocket__bob"><Rocket firing={!holding} /></g>
      </g>
    </svg>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────────────────────

const PATCH_ICON: Record<string, IconName> = {
  Liftoff: "capsule",
  "Satellite belt": "satellite",
  "Deep space": "sparkle",
  Halfway: "mood-just_okay",
  "Moon's pull": "arc-up",
  "Lunar orbit": "orbit",
  Touchdown: "flag",
};

function Patch({ icon, earned, big = false }: { icon: IconName; earned: boolean; big?: boolean }) {
  return (
    <span className={`patch${earned ? " is-earned" : ""}${big ? " patch--big" : ""}`} aria-hidden="true">
      <Icon name={icon} size={big ? 34 : 24} />
    </span>
  );
}

const names = (crew: CrewMember[], ids: string[]) => {
  const n = ids.map((id) => crew.find((c) => c.id === id)).filter((c): c is CrewMember => !!c && !c.me).map((c) => c.name);
  return n.length <= 1 ? n.join("") : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
};

function FuelRow({ crew, fuelers }: { crew: CrewMember[]; fuelers: string[] }) {
  return (
    <ul className="fuel" aria-label="Who has added fuel today">
      {crew.map((c) => {
        const on = fuelers.includes(c.id);
        return (
          <li key={c.id} className={`fuel__seat${on ? " is-on" : ""}${c.me ? " is-me" : ""}`}>
            <span className="fuel__ring"><Avatar id={c.id} name={c.name} size={40} /></span>
            <span className="fuel__name">{c.me ? "You" : c.name}</span>
            <span className="visually-hidden">{on ? "added fuel" : "not yet"}</span>
          </li>
        );
      })}
    </ul>
  );
}

function StatusCard({ j }: { j: Journey }) {
  const others = names(j.crew, j.todayFuelers);
  const waiting = j.crew.filter((c) => !c.me && !j.todayFuelers.includes(c.id));
  if (!j.postedToday) {
    return (
      <section className="panel jstatus jstatus--holding" aria-labelledby="js-title">
        <p className="jstatus__chip"><Icon name="pause" size={16} /> Holding at {formatKm(j.km)}</p>
        <h2 id="js-title" className="jstatus__title">Your crew is waiting on the launch button</h2>
        <p className="jstatus__text">
          {others ? <>{others} added fuel today. </> : null}
          <strong className="jstatus__km">{formatKm(j.tankKm + KM_PER_UPDATE)}</strong> is ready to burn the moment you post.
        </p>
        <FuelRow crew={j.crew} fuelers={j.todayFuelers} />
        <Link className="btn btn--primary btn--big jstatus__cta" to="/brush">
          <Icon name="capsule" size={22} /> Brush and fire the engine
        </Link>
        <p className="jstatus__fine">No rush. Fuel never runs out, and a paused day doesn't undo any distance.</p>
      </section>
    );
  }
  const today = j.week[j.week.length - 1];
  return (
    <section className="panel jstatus jstatus--flying" aria-labelledby="js-title">
      <p className="jstatus__chip is-on"><Icon name="arc-up" size={16} /> Engines firing</p>
      <h2 id="js-title" className="jstatus__title">
        You flew <span className="jstatus__km">{formatKm(today?.km ?? 0)}</span> today
      </h2>
      <p className="jstatus__text">{others ? `Your update burned the fuel ${others} added.` : "Your update fired the engine."}</p>
      <FuelRow crew={j.crew} fuelers={j.todayFuelers} />
      {waiting.length > 0 && (
        <div className="jstatus__nudge">
          <span>{names(j.crew, waiting.map((w) => w.id))} can still add fuel tonight.</span>
          <button className="btn btn--quiet btn--small" type="button"><Icon name="wave" size={18} /> Wave</button>
        </div>
      )}
    </section>
  );
}

function MilestoneBanner({ m }: { m: Milestone }) {
  return (
    <section className="panel jmilestone" aria-live="polite">
      <Patch icon={PATCH_ICON[m.name]} earned big />
      <div className="jmilestone__body">
        <p className="jmilestone__eyebrow">Patch earned</p>
        <h2 className="jmilestone__title">{m.name}</h2>
        <p className="jmilestone__reward"><Icon name="sparkle" size={16} /> Unlocked: {m.reward}</p>
      </div>
      <button className="btn btn--primary btn--small" type="button">Tell the crew</button>
    </section>
  );
}

const WEEKDAY = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { weekday: "narrow" });

function WeekStrip({ week }: { week: FlightDay[] }) {
  return (
    <section className="panel" aria-labelledby="jw-title">
      <div className="jweek__head">
        <h2 id="jw-title" className="section-title">This week's flight log</h2>
        <span className="badge badge--warm">{formatKm(week.reduce((s, d) => s + d.km, 0))}</span>
      </div>
      <ol className="jweek">
        {week.map((d) => {
          const label = d.status === "flew" ? `flew ${formatKm(d.km)}` : d.status === "held" ? "held position" : "today, not posted yet";
          return (
            <li key={d.date} className={`jweek__day is-${d.status}`}>
              <span className="jweek__wd" aria-hidden="true">{WEEKDAY(d.date)}</span>
              <span className="jweek__dot" aria-hidden="true">
                <Icon name={d.status === "flew" ? "arc-up" : d.status === "held" ? "pause" : "capsule"} size={18} />
              </span>
              <span className="jweek__km" aria-hidden="true">{d.status === "flew" ? `+${Math.round(d.km / 1000)}k` : d.status === "held" ? "held" : "today"}</span>
              <span className="visually-hidden">{new Date(`${d.date}T12:00:00`).toLocaleDateString("en-US", { weekday: "long" })}: {label}</span>
            </li>
          );
        })}
      </ol>
      <p className="hint"><Icon name="pause" size={16} /> Held days just wait. Nothing resets.</p>
    </section>
  );
}

function Patches({ j }: { j: Journey }) {
  const next = nextMilestone(j.km);
  return (
    <section className="panel" aria-labelledby="jp-title">
      <h2 id="jp-title" className="section-title">Mission patches</h2>
      <ul className="patches">
        {MILESTONES.map((m) => {
          const earned = j.km >= m.km;
          const isNext = next?.km === m.km;
          return (
            <li key={m.name} className={`patches__item${isNext ? " is-next" : ""}`}>
              <Patch icon={PATCH_ICON[m.name]} earned={earned} />
              <span className="patches__name">{m.name}</span>
              <span className="patches__meta">
                {earned ? m.reward : isNext ? `${updatesTo(j.km, m.km)} updates away` : formatKm(m.km)}
              </span>
            </li>
          );
        })}
        <li className="patches__item">
          <Patch icon="friends" earned={j.fullCrewDays > 0} />
          <span className="patches__name">Full crew ×{j.fullCrewDays}</span>
          <span className="patches__meta">Days everyone posted: double fuel</span>
        </li>
      </ul>
    </section>
  );
}

// ── The page ────────────────────────────────────────────────────────────────────────────────

export function JourneyView({ j }: { j: Journey }) {
  const next = nextMilestone(j.km);
  const today = j.week[j.week.length - 1];
  const before = j.km - (j.postedToday ? today?.km ?? 0 : 0);
  const justReached = j.postedToday ? MILESTONES.find((m) => m.km > before && m.km <= j.km) : undefined;
  const pct = Math.round((j.km / MOON_KM) * 100);

  return (
    <div className="page journey">
      <header className="page-head journey__head">
        <p className="journey__eyebrow">Fly me to the moon</p>
        <h1 className="page-title">Crew journey</h1>
        <div className="journey__crew">
          <span className="journey__faces" aria-hidden="true">
            {j.crew.map((c) => <Avatar key={c.id} id={c.id} name={c.name} size={28} />)}
          </span>
          <span className="muted">{j.crew.map((c) => (c.me ? "You" : c.name)).join(", ")}</span>
        </div>
      </header>

      <section className="jflight" aria-labelledby="jf-title">
        <h2 id="jf-title" className="visually-hidden">Flight path</h2>
        <FlightPath j={j} />
        <div className="jflight__readout">
          <p className="jflight__km num">{formatKm(j.km)}</p>
          <p className="jflight__of">of {formatKm(MOON_KM)} · {pct}% of the way</p>
          <div className="jflight__bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
          {next && (
            <p className="jflight__next">
              Next stop <strong>{next.name}</strong> in {updatesTo(j.km, next.km)} crew updates
            </p>
          )}
        </div>
      </section>

      {justReached && <MilestoneBanner m={justReached} />}
      <StatusCard j={j} />
      <WeekStrip week={j.week} />
      <Patches j={j} />

      <details className="panel jrules">
        <summary>How the flight works</summary>
        <ol>
          <li>Every update from anyone in your crew adds {formatKm(KM_PER_UPDATE)} of fuel.</li>
          <li>When you post, your engine fires and burns everything in the tank.</li>
          <li>Skip a day and the rocket simply holds. The fuel waits for you, and nothing resets.</li>
          <li>Milestones earn patches that unlock new looks for the whole crew.</li>
        </ol>
      </details>
    </div>
  );
}
