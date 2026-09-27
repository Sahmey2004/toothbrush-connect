// Core loop: Start, the moon timer, friend cards, one-tap moods, audience, 30 s hold with Undo.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { usePresence } from "../hooks/usePresence";
import { useSession } from "../hooks/useSession";
import { useCountdown } from "../hooks/useCountdown";
import { useWakeLock } from "../hooks/useWakeLock";
import { haptics } from "../hooks/useHaptics";
import { useShell } from "../components/layout/AppShell";
import { BrushScreen } from "../components/brush/BrushScreen";
import { AudienceSheet } from "../components/check-in/AudienceSheet";
import { SentPill, Snackbar } from "../components/check-in/Snackbar";
import { describeAudience } from "../components/check-in/audience";
import type { Drift } from "../components/presence/BrushingNowBar";
import { moodInfo, type Mood, type Scope } from "../types/moods";
import type { Audience, CheckIn, FriendList } from "../types/api";

const MAX_CARDS = 4; // PRD: up to 4 friend updates, more summarised in one line
const TOTAL = 120_000;

export default function Brush() {
  const { me, refreshMe } = useAuth();
  const { setImmersive } = useShell();
  const sessionRef = useRef(false);
  const reactionsSince = useRef(new Date().toISOString());
  const seenReactions = useRef(new Set<string>());
  const [drifts, setDrifts] = useState<Drift[]>([]);

  const presence = usePresence(
    me?.id,
    () => { if (sessionRef.current) haptics.overlap(); },
    async () => {
      // A friend reacted to me: let it drift up from their avatar.
      const rs = await api.reactionsToMe(reactionsSince.current).catch(() => []);
      const fresh = rs.filter((r) => !seenReactions.current.has(r.id) && r.kind !== "reply");
      fresh.forEach((r) => seenReactions.current.add(r.id));
      if (!fresh.length) return;
      const add: Drift[] = fresh.map((r) => ({ key: r.id, fromId: r.from_user, kind: r.kind as Drift["kind"] }));
      setDrifts((d) => [...d, ...add]);
      setTimeout(() => setDrifts((d) => d.filter((x) => !add.includes(x))), 2800);
    },
  );
  const { session, finished, starting, start, end, dismissFinished } = useSession(me?.id);
  const remaining = useCountdown(session?.ends_at ?? null);
  sessionRef.current = !!session;
  useWakeLock(!!session);
  useEffect(() => { setImmersive(!!session); return () => setImmersive(false); }, [session, setImmersive]);

  const [lists, setLists] = useState<FriendList[]>([]);
  const [scope, setScope] = useState<Scope>("today");
  const [line, setLine] = useState("");
  const [override, setOverride] = useState<Audience | null>(null); // chosen before posting
  const [checkIn, setCheckIn] = useState<CheckIn | null>(null);
  const [sheet, setSheet] = useState<"before" | "hold" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shownIds, setShownIds] = useState<string[]>([]);
  const [sentVisible, setSentVisible] = useState(false);
  const [reactionSent, setReactionSent] = useState<string | null>(null);

  useEffect(() => { api.lists().then(setLists).catch(() => {}); }, []);

  // Restore this session's check-in after a reload.
  useEffect(() => {
    if (!session) return;
    api.myCheckIns(1).then(([c]) => setCheckIn(c && c.session_id === session.id ? c : null)).catch(() => {});
  }, [session]);

  // Reset the composer for each new session.
  useEffect(() => {
    if (session) return;
    setScope("today"); setLine(""); setOverride(null);
  }, [session]);

  const defaultAudience: Audience = me?.settings.default_list_id
    ? { type: "list", listId: me.settings.default_list_id }
    : { type: "everyone" };
  const composerAudience = override ?? defaultAudience;
  const checkInAudience: Audience | null = checkIn
    ? { type: checkIn.audience_type, listId: checkIn.list_id, friendIds: checkIn.friend_ids }
    : null;
  const describe = (a: Audience) => describeAudience(a, presence.friends, lists);

  // When the hold runs out, nudge the scheduler and pick up the delivered state.
  useEffect(() => {
    if (checkIn?.status !== "held") return;
    const wait = Math.max(0, Date.parse(checkIn.deliver_at) - Date.now()) + 300;
    const t = setTimeout(async () => {
      await api.runDueJobs().catch(() => {});
      const [latest] = await api.myCheckIns(1);
      if (latest?.id === checkIn.id) setCheckIn(latest);
    }, wait);
    return () => clearTimeout(t);
  }, [checkIn]);

  // Show the "Sent" pill for a few seconds after delivery, then hand the utility zone back to End.
  useEffect(() => {
    if (checkIn?.status !== "delivered") return;
    setSentVisible(true);
    const t = setTimeout(() => setSentVisible(false), 6000);
    return () => clearTimeout(t);
  }, [checkIn?.id, checkIn?.status]);

  const guard = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }, []);

  const post = (mood: Mood) => guard(async () => {
    haptics.tap();
    setCheckIn(await api.postCheckIn(mood, scope, line, checkInAudience ?? override));
  });

  const confirmSheet = (a: Audience, makeDefault: boolean) => guard(async () => {
    if (sheet === "hold" && checkIn?.status === "held") {
      setCheckIn(await api.setAudience(checkIn.id, a, makeDefault));
    } else {
      setOverride(a);
      if (makeDefault && me) {
        await api.updateSettings({ default_list_id: a.type === "list" ? a.listId ?? null : null }, me.id);
      }
    }
    if (makeDefault) await refreshMe();
    setSheet(null);
  });

  const undo = () => guard(async () => { if (checkIn) { await api.undoCheckIn(checkIn.id); setCheckIn(null); } });
  const del = () => guard(async () => { if (checkIn) { await api.deleteCheckIn(checkIn.id); setCheckIn(null); } });

  // Friend updates for this session: unseen first, newest first.
  const cards = useMemo(() => {
    const unseen = presence.feed.filter((f) => !f.seen_at || shownIds.includes(f.check_in_id));
    return (unseen.length ? unseen : presence.feed).slice(0, 12);
  }, [presence.feed, shownIds]);
  const visible = cards.slice(0, MAX_CARDS);

  const unseenVisible = visible.filter((v) => !v.seen_at && !shownIds.includes(v.check_in_id)).map((v) => v.check_in_id).join(",");
  useEffect(() => {
    if (!session || !unseenVisible) return;
    const ids = unseenVisible.split(",");
    setShownIds((prev) => [...prev, ...ids]);
    api.markSeen(ids).catch(() => {});
  }, [session, unseenVisible]);

  // Swipe down on the moon to end early (FR-W6).
  const swipeStart = useRef<number | null>(null);
  const displayProps = {
    onPointerDown: (e: React.PointerEvent) => { swipeStart.current = e.clientY; },
    onPointerUp: (e: React.PointerEvent) => {
      if (session && swipeStart.current !== null && e.clientY - swipeStart.current > 120) end();
      swipeStart.current = null;
    },
  };

  if (!me) return null;

  const brushingNow = presence.brushingNow.map((f) => ({ id: f.friend_id, name: f.display_name || "A friend" }));
  const react = (kind: "wave" | "heart" | "laugh") => {
    haptics.tap();
    setReactionSent(kind);
    setTimeout(() => setReactionSent(null), 2000);
    const buddy = presence.brushingNow[0];
    if (buddy?.latest_check_in_id) api.react(buddy.latest_check_in_id, kind).catch(() => {});
  };

  const caughtUp = [...new Map(presence.feed.filter((f) => shownIds.includes(f.check_in_id))
    .map((f) => [f.author_id, { id: f.author_id, name: f.author_name }])).values()];

  const phase = session ? "active" : finished ? "done" : "idle";
  const posted = checkIn && checkIn.status !== "undone" ? checkIn : null;

  let snackbar = null;
  if (session && posted?.status === "held") {
    snackbar = <Snackbar deliverAt={posted.deliver_at} audienceLabel={describe(checkInAudience!)} busy={busy}
      onUndo={undo} onChange={() => setSheet("hold")} />;
  } else if (session && posted?.status === "delivered" && sentVisible) {
    snackbar = <SentPill audienceLabel={describe(checkInAudience!)} onDelete={del} busy={busy} />;
  }

  return (
    <BrushScreen
      phase={phase}
      elapsedMs={session ? TOTAL - remaining : finished ? TOTAL : 0}
      hand={me.settings.dominant_hand}
      brushingNow={brushingNow}
      drifts={drifts}
      cards={visible}
      moreCount={cards.length - visible.length}
      audienceLabel={describe(checkInAudience ?? composerAudience)}
      scope={scope}
      line={line}
      selectedMood={posted?.mood ?? null}
      moodsLocked={posted?.status === "delivered"}
      snackbar={snackbar}
      reactionSent={reactionSent}
      caughtUp={caughtUp}
      doneNote={posted ? `Your ${moodInfo(posted.mood).label.toLowerCase()} update went to ${describe(checkInAudience!)}.` : undefined}
      starting={starting}
      busy={busy}
      error={error}
      displayProps={displayProps}
      onStart={() => guard(async () => { await start(); })}
      onEnd={end}
      onDismissDone={() => { dismissFinished(); setCheckIn(null); setShownIds([]); }}
      onPickMood={post}
      onScope={setScope}
      onLine={setLine}
      onOpenAudience={() => setSheet(posted?.status === "held" ? "hold" : "before")}
      onReact={react}
      sheet={
        <AudienceSheet
          open={sheet !== null}
          initial={sheet === "hold" && checkInAudience ? checkInAudience : composerAudience}
          friends={presence.friends}
          lists={lists}
          confirmLabel={sheet === "hold" ? "Done, send now" : "Done"}
          onClose={() => setSheet(null)}
          onConfirm={confirmSheet}
        />
      }
    />
  );
}
