import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { BrushSession } from "../types/api";
import { haptics } from "./useHaptics";

const QUADRANTS_MS = [90_000, 60_000, 30_000]; // remaining time at 1:30, 1:00, 0:30

// The current brush session: start, end early, quadrant haptics and the 2:00 finish.
// Finish + haptics fire from timers (not a per-frame countdown), so a shared consumer of
// this session doesn't re-render every animation frame. Smooth countdowns are drawn by the
// timer components with their own useCountdown(session.ends_at).
export function useSession(userId: string | undefined) {
  const [session, setSession] = useState<BrushSession | null>(null);
  const [finished, setFinished] = useState<BrushSession | null>(null);
  const [starting, setStarting] = useState(false);
  const actedRef = useRef(false); // start/end called: the on-load lookup below is stale

  useEffect(() => {
    // A slow answer to this lookup must not wipe a session the person started meanwhile.
    if (userId) api.activeSession(userId).then((s) => { if (!actedRef.current) setSession(s); }).catch(() => {});
  }, [userId]);

  useEffect(() => {
    if (!session) return;
    const ends = Date.parse(session.ends_at);
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const q of QUADRANTS_MS) {
      const at = ends - q - Date.now();
      if (at > 0) timers.push(setTimeout(() => haptics.quadrant(), at));
    }
    timers.push(setTimeout(() => {
      haptics.done();
      setFinished(session);
      setSession(null);
      api.runDueJobs().catch(() => {});
    }, Math.max(0, ends - Date.now())));
    return () => timers.forEach(clearTimeout);
  }, [session]);

  const start = useCallback(async () => {
    actedRef.current = true;
    setStarting(true);
    try {
      const s = await api.startSession();
      setFinished(null);
      setSession(s);
      haptics.tap();
      return s;
    } finally {
      setStarting(false);
    }
  }, []);

  const end = useCallback(async () => {
    if (!session) return;
    actedRef.current = true;
    const ended = await api.endSession(session.id);
    setFinished(ended ?? session);
    setSession(null);
  }, [session]);

  return { session, finished, starting, start, end, dismissFinished: () => setFinished(null) };
}
