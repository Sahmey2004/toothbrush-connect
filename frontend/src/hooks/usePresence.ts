import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { subscribeToCircle } from "../realtime/channels";
import type { BrushSession, CircleMember, FeedItem } from "../types/api";

// Circle, feed and live presence for the signed-in user, kept fresh by Supabase Realtime.
export function usePresence(myId: string | undefined, onFriendStarted?: (friendId: string) => void) {
  const [circle, setCircle] = useState<CircleMember[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [brushing, setBrushing] = useState<Record<string, string>>({}); // friendId → ends_at
  const [loaded, setLoaded] = useState(false);

  const refreshCircle = useCallback(async () => {
    const c = await api.circle();
    setCircle(c);
    setBrushing((prev) => {
      const next: Record<string, string> = {};
      for (const m of c) if (m.brushing_now) next[m.friend_id] = prev[m.friend_id] ?? new Date(Date.now() + 120_000).toISOString();
      return next;
    });
  }, []);
  const refreshFeed = useCallback(async () => setFeed(await api.feed()), []);

  useEffect(() => {
    if (!myId) return;
    Promise.all([refreshCircle(), refreshFeed()]).finally(() => setLoaded(true));
    return subscribeToCircle(myId, {
      onFriendSession: (s: BrushSession, event) => {
        const live = s.status === "active" && Date.parse(s.ends_at) > Date.now();
        setBrushing((prev) => {
          const next = { ...prev };
          if (live) next[s.user_id] = s.ends_at;
          else delete next[s.user_id];
          return next;
        });
        if (live && event === "INSERT") onFriendStarted?.(s.user_id);
      },
      onDelivered: () => {
        refreshFeed();
        refreshCircle();
      },
      onCircleChange: refreshCircle,
    });
    // onFriendStarted is intentionally read once per subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myId, refreshCircle, refreshFeed]);

  // Drop friends whose 2:00 ran out (Realtime can't send us their end if it arrives after the RLS window).
  useEffect(() => {
    const t = setInterval(() => {
      setBrushing((prev) => {
        const next = Object.fromEntries(Object.entries(prev).filter(([, ends]) => Date.parse(ends) > Date.now()));
        return Object.keys(next).length === Object.keys(prev).length ? prev : next;
      });
    }, 5000);
    return () => clearInterval(t);
  }, []);

  const friends = circle.filter((m) => m.friendship_status === "accepted");
  const brushingNow = friends.filter((f) => brushing[f.friend_id]);
  return { circle, friends, feed, brushingNow, loaded, refreshCircle, refreshFeed };
}
