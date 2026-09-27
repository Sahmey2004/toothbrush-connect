import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { BrushSession } from "../types/api";
import { haptics } from "./useHaptics";
import { useCountdown } from "./useCountdown";

const QUADRANTS_MS = [90_000, 60_000, 30_000]; // remaining time at 0:30, 1:00, 1:30

// The current brush session: start, end early, quadrant haptics and the 2:00 finish.
export function useSession(userId: string | undefined) {
  const [session, setSession] = useState<BrushSession | null>(null);
  const [finished, setFinished] = useState<BrushSession | null>(null);
  const [starting, setStarting] = useState(false);
  const remaining = useCountdown(session?.ends_at ?? null);
  const firedRef = useRef<Set<number>>(new Set());
  const actedRef = useRef(false); // start/end called: the on-load lookup below is stale

  useEffect(() => {
    // A slow answer to this lookup must not wipe a session the person started meanwhile.
    if (userId) api.activeSession(userId).then((s) => { if (!actedRef.current) setSession(s); }).catch(() => {});
  }, [userId]);

  useEffect(() => {
    if (!session) return;
    for (const q of QUADRANTS_MS) {
      if (remaining <= q && remaining > 0 && !firedRef.current.has(q)) {
        firedRef.current.add(q);
        haptics.quadrant();
      }
    }
    if (remaining === 0) {
      haptics.done();
      setFinished(session);
      setSession(null);
      api.runDueJobs().catch(() => {});
    }
  }, [remaining, session]);

  const start = useCallback(async () => {
    actedRef.current = true;
    setStarting(true);
    try {
      const s = await api.startSession();
      firedRef.current = new Set();
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

  return { session, remaining, finished, starting, start, end, dismissFinished: () => setFinished(null) };
}
