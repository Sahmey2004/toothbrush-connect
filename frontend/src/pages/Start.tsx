// The first screen after sign-in, like a game's start screen: one moon, one button.
// Starting turns the moon into the 2:00 timer, which glides up to make room for today's update.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { formatClock } from "../hooks/useCountdown";
import { haptics } from "../hooks/useHaptics";
import { usePresence } from "../hooks/usePresence";
import { useSession } from "../hooks/useSession";
import { useWakeLock } from "../hooks/useWakeLock";
import { MoonTimer, type MoonState } from "../components/timer/MoonTimer";
import { MOODS, moodInfo, type Mood } from "../types/moods";
import type { Audience, CheckIn } from "../types/api";
import "../styles/pop.css";
import "../styles/start.css";

const TOTAL_MS = 120_000;
const HOLD_MS = 1100; // the big clock stays centred this long before it glides up
const DOCK_MS = 1600;

type Phase = "idle" | "launch" | "docked";

// Placed in % so they stay round and on screen at any size.
const STARS = [
  { x: 8, y: 12, r: 2, c: "#FFFFFF", o: 0.6 },
  { x: 91, y: 9, r: 2.5, c: "#FFE27A", o: 1 },
  { x: 63, y: 4, r: 1.5, c: "#FFFFFF", o: 0.5 },
  { x: 2.5, y: 47, r: 2, c: "#FFFFFF", o: 0.5 },
  { x: 96, y: 64, r: 3, c: "#6FE0E8", o: 1 },
  { x: 14, y: 86, r: 2, c: "#FFFFFF", o: 0.5 },
  { x: 84, y: 92, r: 2, c: "#FFFFFF", o: 0.6 },
];

function Sky() {
  return (
    <div className="st-sky" aria-hidden="true">
      {STARS.map((s, i) => (
        <span key={i} className="st-star"
          style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.r * 2, height: s.r * 2, background: s.c, opacity: s.o }} />
      ))}
      <svg className="st-sparkle" style={{ left: "9%", top: "19%" }} width="18" height="18" viewBox="0 0 16 16">
        <path d="M8 0 Q8 8 16 8 Q8 8 8 16 Q8 8 0 8 Q8 8 8 0 Z" fill="#F272D8" />
      </svg>
      <svg className="st-sparkle" style={{ left: "87%", top: "15%" }} width="14" height="14" viewBox="0 0 16 16">
        <path d="M8 0 Q8 8 16 8 Q8 8 8 16 Q8 8 0 8 Q8 8 8 0 Z" fill="#FFE27A" />
      </svg>
    </div>
  );
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function Start() {
  const { me } = useAuth();
  const navigate = useNavigate();
  const { session, remaining, finished, starting, start, end, dismissFinished } = useSession(me?.id);
  const { brushingNow, friends } = usePresence(me?.id);
  useWakeLock(!!session);

  const [phase, setPhase] = useState<Phase>("idle");
  const [line, setLine] = useState("");
  const [picked, setPicked] = useState<Mood | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkIn, setCheckIn] = useState<CheckIn | null>(null); // today's update, once posted
  const [audMode, setAudMode] = useState<"everyone" | "some">("everyone"); // who this update goes to
  const [audPicked, setAudPicked] = useState<Set<string>>(() => new Set());
  const [audOpen, setAudOpen] = useState(false);
  const timerRef = useRef<HTMLDivElement>(null);
  const fromRect = useRef<DOMRect | null>(null);
  const lastProgress = useRef(0);
  const [intro, setIntro] = useState(false); // the prompt's first reveal waits for the dock to finish

  // Keep the cosmic backdrop edge-to-edge (incl. overscroll) while this page is mounted.
  useEffect(() => {
    document.body.classList.add("pop-body");
    return () => document.body.classList.remove("pop-body");
  }, []);

  // A session appeared (just started, or still running after a reload): show the big clock.
  useEffect(() => {
    if (phase === "idle" && session) setPhase("launch");
  }, [phase, session]);

  // Hold the big clock for a beat, then note where it sits and dock it at the top.
  useEffect(() => {
    if (phase !== "launch") return;
    const t = setTimeout(() => {
      fromRect.current = timerRef.current?.getBoundingClientRect() ?? null;
      setIntro(true);
      setPhase("docked");
    }, reducedMotion() ? 0 : HOLD_MS);
    return () => clearTimeout(t);
  }, [phase]);

  // FLIP: the timer is now laid out small at the top; play it in from its big centred spot,
  // dipping in opacity on the way so it fades as it zooms out.
  useLayoutEffect(() => {
    const el = timerRef.current;
    const from = fromRect.current;
    fromRect.current = null;
    if (phase !== "docked" || !el || !from || reducedMotion()) return;
    const to = el.getBoundingClientRect();
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top - to.top;
    const scale = from.width / to.width;
    el.animate(
      [{ transform: `translate(${dx}px, ${dy}px) scale(${scale})` }, { transform: "none" }],
      { duration: DOCK_MS, easing: "cubic-bezier(0.65, 0, 0.35, 1)" },
    );
    el.animate([{ opacity: 1 }, { opacity: 0.35, offset: 0.4 }, { opacity: 1 }], { duration: DOCK_MS, easing: "ease-in-out" });
  }, [phase]);

  // After a reload mid-session, show the update already posted in it instead of asking again.
  useEffect(() => {
    if (!session) return;
    api.myCheckIns(1).then(([c]) => {
      if (c && c.session_id === session.id && (c.status === "held" || c.status === "delivered")) setCheckIn(c);
    }).catch(() => {});
  }, [session]);

  // When the 30 s hold runs out, nudge delivery and pick up the delivered state.
  useEffect(() => {
    if (checkIn?.status !== "held") return;
    const t = setTimeout(async () => {
      await api.runDueJobs().catch(() => {});
      const [latest] = await api.myCheckIns(1).catch(() => [] as CheckIn[]);
      if (latest?.id === checkIn.id && latest.status !== "held") setCheckIn(latest);
    }, Math.max(0, Date.parse(checkIn.deliver_at) - Date.now()) + 300);
    return () => clearTimeout(t);
  }, [checkIn]);

  const live = session ? Math.min(1, Math.max(0, 1 - remaining / TOTAL_MS)) : null;
  useEffect(() => {
    if (live !== null) lastProgress.current = live;
  });

  // Once the brush session ends — whether the 2:00 runs out or you end early — land on the
  // feed (home) with the nav bar. A short beat lets the "Done" moon show first.
  useEffect(() => {
    if (!finished) return;
    const t = setTimeout(() => navigate("/feed"), reducedMotion() ? 0 : 900);
    return () => clearTimeout(t);
  }, [finished, navigate]);

  if (!me) return null;

  const progress = live ?? (finished ? lastProgress.current : 0);
  const moonState: MoonState = session ? "flying" : finished ? "done" : "parked";
  const clock = session ? formatClock(Math.min(remaining, TOTAL_MS)) : finished ? "Done" : "2:00";

  const begin = async () => {
    setError(null);
    try {
      await start();
    } catch (e) {
      setError(message(e));
    }
  };

  const send = async (mood: Mood) => {
    if (picked) return;
    setPicked(mood);
    setError(null);
    setNote(null);
    haptics.tap();
    const audience: Audience =
      audMode === "some" && audPicked.size > 0
        ? { type: "custom", friendIds: [...audPicked] }
        : { type: "everyone" };
    try {
      setCheckIn(await api.postCheckIn(mood, "today", line.trim(), audience));
      setIntro(false); // if it comes back (Undo), it comes back right away
    } catch (e) {
      setError(message(e));
    } finally {
      setPicked(null);
    }
  };

  const undo = async () => {
    if (!checkIn) return;
    setError(null);
    try {
      await api.undoCheckIn(checkIn.id);
      setCheckIn(null);
    } catch (e) {
      setError(message(e));
    }
  };

  // Back to the start screen, ready for another round.
  const reset = () => {
    dismissFinished();
    setPhase("idle");
    setCheckIn(null);
    setLine("");
    setNote(null);
    setError(null);
    lastProgress.current = 0;
  };

  // Explicit end: stop the session completely and go straight home (no waiting for 2:00).
  const endNow = async () => {
    try {
      await end();
    } catch (e) {
      setError(message(e));
      return;
    }
    navigate("/feed");
  };

  const toggleFriend = (id: string) => {
    const next = new Set(audPicked);
    if (next.has(id)) next.delete(id); else next.add(id);
    setAudPicked(next);
    setAudMode(next.size ? "some" : "everyone");
  };
  const audLabel =
    audMode === "everyone"
      ? "Everyone"
      : audPicked.size === 1
        ? friends.find((f) => f.friend_id === [...audPicked][0])?.display_name ?? "1 friend"
        : `${audPicked.size} friends`;

  const friendsBrushing = brushingNow.length;
  const leave = session
    ? <button type="button" className="st-end" onClick={endNow}>End early</button>
    : <button type="button" className="st-end" onClick={reset}>Back to start</button>;

  return (
    <div className={`pop st st--${phase}`}>
      <Sky />
      <main className="st-stage">
        <div className="st-timer" ref={timerRef}>
          <div className="st-timer__moon">
            <MoonTimer progress={progress} state={moonState} />
          </div>
          {phase !== "idle" && <p className="st-clock" role="timer">{clock}</p>}
        </div>

        {phase === "docked" && checkIn ? (
          <section className="st-prompt st-sent">
            <p className="st-sent__face" aria-hidden="true">{moodInfo(checkIn.mood).emoji}</p>
            <h1 className="st-prompt__q">{checkIn.status === "held" ? "Sending to your friends" : "Sent to your friends"}</h1>
            <p className="st-sent__line" role="status">
              {checkIn.status === "held" ? "They'll see it in 30 seconds." : "They can see it now."}
            </p>
            <button type="button" className="st-go st-endnow" onClick={endNow}>End brushing now</button>
            {checkIn.status === "held" && <button type="button" className="st-undo" onClick={undo}>Undo</button>}
            {error && <p className="st-error" role="alert">{error}</p>}
          </section>
        ) : phase === "docked" ? (
          <form className={`st-prompt${intro ? " st-prompt--intro" : ""}`} onSubmit={(e) => { e.preventDefault(); setNote("Now pick a face to send it."); }}>
            <h1 className="st-prompt__q">How's today going?</h1>
            <div className="st-aud">
              <button type="button" className="st-aud__chip" onClick={() => setAudOpen((o) => !o)} aria-expanded={audOpen}>
                To: {audLabel} <span aria-hidden="true">{audOpen ? "▲" : "▾"}</span>
              </button>
              {audOpen && (
                <div className="st-aud__panel" role="group" aria-label="Who to send this to">
                  <button type="button" className={"st-aud__opt" + (audMode === "everyone" ? " is-on" : "")}
                    onClick={() => { setAudMode("everyone"); setAudPicked(new Set()); }} aria-pressed={audMode === "everyone"}>
                    Everyone
                  </button>
                  {friends.map((f) => {
                    const on = audPicked.has(f.friend_id);
                    return (
                      <button key={f.friend_id} type="button" className={"st-aud__opt" + (on ? " is-on" : "")}
                        onClick={() => toggleFriend(f.friend_id)} aria-pressed={on}>
                        {f.display_name || "Friend"}
                      </button>
                    );
                  })}
                  {friends.length === 0 && <p className="st-aud__empty">Add friends to send to specific people.</p>}
                </div>
              )}
            </div>
            <div className="st-moods" role="group" aria-label="How's today going?">
              {MOODS.map((m) => (
                <button key={m.id} type="button" className={`st-mood${picked === m.id ? " is-picked" : ""}`}
                  onClick={() => send(m.id)} disabled={picked !== null} aria-pressed={picked === m.id}>
                  <span className="st-mood__emoji" aria-hidden="true">{m.emoji}</span>
                  {m.label}
                </button>
              ))}
            </div>
            <label className="st-line">
              <span className="visually-hidden">A line for your friends</span>
              <input value={line} maxLength={140} placeholder="Add a line if you like" enterKeyHint="done"
                onChange={(e) => setLine(e.target.value)} />
              {line.length > 120 && <span className="st-line__count">{140 - line.length}</span>}
            </label>
            <p className="st-note" role="status">{error ? "" : note}</p>
            {error && <p className="st-error" role="alert">{error}</p>}
            {leave}
          </form>
        ) : (
          <div className="st-intro">
            <h1 className="st-title">Ready to brush?</h1>
            <button type="button" className="st-go" onClick={begin} disabled={starting || phase !== "idle"}>
              {starting ? "Starting…" : "Start brushing"}
            </button>
            {friendsBrushing > 0 && (
              <p className="st-friends">
                {friendsBrushing} {friendsBrushing === 1 ? "friend is" : "friends are"} brushing now
              </p>
            )}
            {error && <p className="st-error" role="alert">{error}</p>}
          </div>
        )}
      </main>
    </div>
  );
}
