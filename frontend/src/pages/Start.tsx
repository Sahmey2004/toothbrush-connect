// The first screen after sign-in, like a game's start screen: one moon, one button.
// Starting turns the moon into the 2:00 timer, which glides up to make room for today's update.
// Once you send, we move to the feed — the timer keeps running there (see BrushLayout + PopShell).
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { useBrush } from "../brush/BrushContext";
import { formatClock, useCountdown } from "../hooks/useCountdown";
import { haptics } from "../hooks/useHaptics";
import { usePresence } from "../hooks/usePresence";
import { MoonTimer, type MoonState } from "../components/timer/MoonTimer";
import { MOODS, moodInfo, type Mood } from "../types/moods";
import type { Audience } from "../types/api";
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
        <path d="M8 0 Q8 8 16 8 Q8 8 8 16 Q8 8 8 0 8 Q8 8 8 0 Z" fill="#FFE27A" />
      </svg>
    </div>
  );
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function Start() {
  const { me } = useAuth();
  const navigate = useNavigate();
  const { session, finished, starting, start, end, dismissFinished } = useBrush();
  const remaining = useCountdown(session?.ends_at ?? null);
  const { brushingNow, friends } = usePresence(me?.id);

  const [phase, setPhase] = useState<Phase>("idle");
  const [line, setLine] = useState("");
  const [pending, setPending] = useState<Mood | null>(null); // selected mood (optional)
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audMode, setAudMode] = useState<"everyone" | "some">("everyone");
  const [audPicked, setAudPicked] = useState<Set<string>>(() => new Set());
  const [audOpen, setAudOpen] = useState(false);
  const [intro, setIntro] = useState(false); // the prompt's first reveal waits for the dock to finish

  const timerRef = useRef<HTMLDivElement>(null);
  const fromRect = useRef<DOMRect | null>(null);
  const lastProgress = useRef(0);
  const sawSessionRef = useRef(false); // a live session this visit → a finish here is real, not stale

  // Keep the cosmic backdrop edge-to-edge (incl. overscroll) while this page is mounted.
  useEffect(() => {
    document.body.classList.add("pop-body");
    return () => document.body.classList.remove("pop-body");
  }, []);

  // Entering /start fresh: drop any leftover "finished" from a previous brush so it shows idle.
  useEffect(() => {
    if (finished && !session) dismissFinished();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (session) sawSessionRef.current = true; }, [session]);

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

  // FLIP: the timer is now laid out small at the top; play it in from its big centred spot.
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

  // If the 2:00 runs out while you're still here (you never sent), head to the feed too.
  useEffect(() => {
    if (!finished || !sawSessionRef.current) return;
    const t = setTimeout(() => navigate("/feed"), reducedMotion() ? 0 : 900);
    return () => clearTimeout(t);
  }, [finished, navigate]);

  const live = session ? Math.min(1, Math.max(0, 1 - remaining / TOTAL_MS)) : null;
  useEffect(() => {
    if (live !== null) lastProgress.current = live;
  });

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

  // Tapping a mood selects (or unselects) it — a mood is optional; you can send just a line.
  const choose = (mood: Mood) => {
    setPending((cur) => (cur === mood ? null : mood));
    setNote(null);
    setError(null);
    haptics.tap();
  };

  // Ask before sending. Need a mood OR a line — but not both.
  const askSend = () => {
    if (!pending && !line.trim()) {
      setNote("Pick a face or add a line first.");
      return;
    }
    setNote(null);
    setConfirming(true);
  };

  // Confirmed: send your update, then move to the feed — the timer keeps running there.
  const confirmSend = async () => {
    if (sending || (!pending && !line.trim())) return;
    setSending(true);
    setError(null);
    const audience: Audience =
      audMode === "some" && audPicked.size > 0
        ? { type: "custom", friendIds: [...audPicked] }
        : { type: "everyone" };
    try {
      await api.postCheckIn(pending, "today", line.trim(), audience);
      navigate("/feed", { state: { justSent: true } });
    } catch (e) {
      setError(message(e));
      setSending(false);
    }
  };
  const cancelSend = () => { setConfirming(false); setSending(false); };

  // Explicit early end: stop the session completely and go home.
  const endNow = async () => {
    try {
      await end();
    } catch (e) {
      setError(message(e));
      return;
    }
    navigate("/feed");
  };

  // Back to the start screen, ready for another round.
  const reset = () => {
    dismissFinished();
    setPhase("idle");
    setLine("");
    setNote(null);
    setError(null);
    lastProgress.current = 0;
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

        {phase === "docked" ? (
          <form className={`st-prompt${intro ? " st-prompt--intro" : ""}`} onSubmit={(e) => { e.preventDefault(); askSend(); }}>
            {confirming ? (
              <div className="st-confirm">
                <p className="st-confirm__q">
                  Send {pending ? `${moodInfo(pending).emoji} ${moodInfo(pending).label}` : "your note"} to {audLabel}?
                </p>
                {line.trim() && <p className="st-confirm__note">“{line.trim()}”</p>}
                <button type="button" className="st-go" onClick={confirmSend} disabled={sending}>
                  {sending ? "Sending…" : "Send it"}
                </button>
                <button type="button" className="st-end" onClick={cancelSend} disabled={sending}>Cancel</button>
              </div>
            ) : (
            <>
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
                <button key={m.id} type="button" className={`st-mood${pending === m.id ? " is-picked" : ""}`}
                  onClick={() => choose(m.id)} disabled={sending} aria-pressed={pending === m.id}>
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
            <button type="button" className="st-go st-send" onClick={askSend} disabled={!pending && !line.trim()}>Send</button>
            <p className="st-note" role="status">{note}</p>
            {leave}
            </>
            )}
            {error && <p className="st-error" role="alert">{error}</p>}
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
