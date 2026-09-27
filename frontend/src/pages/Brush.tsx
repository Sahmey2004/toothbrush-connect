// Core loop: big Start target, countdown, friend cards, mood chips, audience chip, 30 s hold with Undo.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { usePresence } from "../hooks/usePresence";
import { useSession } from "../hooks/useSession";
import { useCountdown } from "../hooks/useCountdown";
import { useWakeLock } from "../hooks/useWakeLock";
import { haptics } from "../hooks/useHaptics";
import { ThumbZoneLayout } from "../components/layout/ThumbZoneLayout";
import { BrushingNowBar } from "../components/presence/BrushingNowBar";
import { BrushBuddyBanner } from "../components/presence/BrushBuddyBanner";
import { CountdownRing } from "../components/timer/CountdownRing";
import { StartButton } from "../components/timer/StartButton";
import { FriendCard } from "../components/feed/FriendCard";
import { MoodChips } from "../components/check-in/MoodChips";
import { ScopeToggle } from "../components/check-in/ScopeToggle";
import { AddLine } from "../components/check-in/AddLine";
import { AudienceChip } from "../components/check-in/AudienceChip";
import { AudienceSheet } from "../components/check-in/AudienceSheet";
import { HoldBanner } from "../components/check-in/HoldBanner";
import { describeAudience } from "../components/check-in/audience";
import { ErrorNote } from "../components/common/ErrorNote";
import { moodInfo, type Mood, type Scope } from "../types/moods";
import type { Audience, CheckIn, CircleMember, FriendList } from "../types/api";

const MAX_CARDS = 4; // PRD: up to 4 friend updates, more summarised in one line

export default function Brush() {
  const { me, refreshMe } = useAuth();
  const [buddy, setBuddy] = useState<string | null>(null);
  const sessionRef = useRef(false);

  // The callback is registered once, so it reads friends through a ref, not a stale closure.
  const friendsRef = useRef<CircleMember[]>([]);
  const presence = usePresence(me?.id, (friendId) => {
    if (!sessionRef.current) return;
    const f = friendsRef.current.find((x) => x.friend_id === friendId);
    setBuddy(f?.display_name || "A friend");
    haptics.overlap();
  });
  friendsRef.current = presence.friends;
  const { session, finished, starting, start, end, dismissFinished } = useSession(me?.id);
  const remaining = useCountdown(session?.ends_at ?? null);
  sessionRef.current = !!session;
  useWakeLock(!!session);

  const [lists, setLists] = useState<FriendList[]>([]);
  const [scope, setScope] = useState<Scope>("today");
  const [line, setLine] = useState("");
  const [override, setOverride] = useState<Audience | null>(null); // chosen before posting
  const [checkIn, setCheckIn] = useState<CheckIn | null>(null);
  const [recipients, setRecipients] = useState<number | null>(null);
  const [sheet, setSheet] = useState<"before" | "hold" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shownIds, setShownIds] = useState<string[]>([]);

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

  useEffect(() => {
    if (checkIn?.status === "delivered") api.recipientCount(checkIn.id).then(setRecipients).catch(() => {});
    else setRecipients(null);
  }, [checkIn?.id, checkIn?.status]);

  const guard = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }, []);

  const post = (mood: Mood) => guard(async () => {
    haptics.tap();
    setCheckIn(await api.postCheckIn(mood, scope, line, override));
  });

  const confirmSheet = (a: Audience, makeDefault: boolean) => guard(async () => {
    if (sheet === "hold" && checkIn) {
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
  const extra = cards.length - visible.length;

  const unseenVisible = visible.filter((v) => !v.seen_at && !shownIds.includes(v.check_in_id)).map((v) => v.check_in_id).join(",");
  useEffect(() => {
    if (!session || !unseenVisible) return;
    const ids = unseenVisible.split(",");
    setShownIds((prev) => [...prev, ...ids]);
    api.markSeen(ids).catch(() => {});
  }, [session, unseenVisible]);

  // Swipe down on the display to end early (FR-T5).
  const swipeStart = useRef<number | null>(null);
  const onPointerDown = (e: React.PointerEvent) => { swipeStart.current = e.clientY; };
  const onPointerUp = (e: React.PointerEvent) => {
    if (session && swipeStart.current !== null && e.clientY - swipeStart.current > 120) end();
    swipeStart.current = null;
  };

  if (!me) return null;

  const caughtUp = new Set(presence.feed.filter((f) => shownIds.includes(f.check_in_id)).map((f) => f.author_id)).size;

  const display = (
    <div className="brush-display" onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
      {session && <CountdownRing remainingMs={remaining} />}
      {finished && !session && (
        <div className="done">
          <p className="label">[🎉 DONE]</p>
          <p className="done__title">2 minutes up.</p>
          <p className="done__line">
            {caughtUp > 0 ? `You caught up with ${caughtUp} ${caughtUp === 1 ? "friend" : "friends"}.` : "Clean teeth, clear head."}
          </p>
        </div>
      )}
      <div className="cards">
        {visible.map((item) => <FriendCard key={item.check_in_id} item={item} />)}
        {extra > 0 && <Link className="cards__more" to="/timeline">+{extra} more {extra === 1 ? "update" : "updates"}</Link>}
        {presence.loaded && presence.feed.length === 0 && !session && (
          <div className="empty">
            {presence.friends.length === 0 ? (
              <>
                <p>Your circle is empty. Friends' updates will show up here.</p>
                <Link className="btn btn--primary" to="/circle">Invite a friend</Link>
              </>
            ) : (
              <p>No updates yet. Post yours and your friends will see it after 30 seconds.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );

  let action;
  if (!session && !finished) {
    action = <StartButton onStart={() => guard(async () => { await start(); })} busy={starting} friendsBrushing={presence.brushingNow.length} />;
  } else if (!session && finished) {
    action = (
      <div className="composer composer--done">
        {checkIn && checkIn.status !== "undone" && (
          <p className="composer__status">You posted {moodInfo(checkIn.mood).emoji} {moodInfo(checkIn.mood).label}.</p>
        )}
        <button className="btn btn--primary btn--big" onClick={() => { dismissFinished(); setCheckIn(null); }}>Done</button>
      </div>
    );
  } else if (checkIn?.status === "held") {
    action = (
      <HoldBanner checkIn={checkIn} audienceLabel={describe(checkInAudience!)} busy={busy}
        onUndo={undo} onChoose={() => setSheet("hold")} />
    );
  } else if (checkIn?.status === "delivered") {
    const m = moodInfo(checkIn.mood);
    action = (
      <section className="sent">
        <p className="label">[✅ POSTED · {m.word}]</p>
        <p className="sent__line">
          Sent to {recipients === null ? "your circle" : `${recipients} ${recipients === 1 ? "friend" : "friends"}`}.
        </p>
        <div className="sent__actions">
          <button className="btn btn--quiet" onClick={del} disabled={busy}>Delete</button>
          <Link className="btn btn--quiet" to="/timeline">See updates</Link>
        </div>
      </section>
    );
  } else if (presence.loaded && presence.friends.length === 0) {
    const waitingOn = presence.circle.filter((c) => c.friendship_status === "pending" && c.requested_by_me).length;
    action = (
      <section className="sent">
        <p className="label">[👋 INVITE]</p>
        <p className="sent__line">Add a friend first.</p>
        <p className="hold__text">
          {waitingOn
            ? `Your ${waitingOn === 1 ? "invite is" : `${waitingOn} invites are`} still waiting for a yes. Updates only go to friends who accepted.`
            : "Updates only go to friends in your circle."}
        </p>
        <div className="sent__actions">
          <Link className="btn btn--primary" to="/circle">Invite friends</Link>
        </div>
      </section>
    );
  } else {
    action = (
      <div className="composer">
        <p className="composer__prompt">How was your {scope === "today" ? "day" : "week"}?</p>
        <AudienceChip label={describe(composerAudience)} onOpen={() => setSheet("before")} />
        <MoodChips onPick={post} disabled={busy} />
        <div className="composer__row">
          <ScopeToggle value={scope} onChange={setScope} />
          <AddLine value={line} onChange={setLine} />
        </div>
      </div>
    );
  }

  return (
    <>
      <BrushBuddyBanner name={buddy} onDone={() => setBuddy(null)} />
      <ThumbZoneLayout
        status={<BrushingNowBar friends={presence.brushingNow} />}
        display={display}
        action={<>{action}<ErrorNote error={error} /></>}
        utility={session ? (
          <button className="end" onClick={end}>End session <span aria-hidden>↓</span><span className="visually-hidden"> (or swipe down)</span></button>
        ) : undefined}
      />
      <AudienceSheet
        open={sheet !== null}
        initial={sheet === "hold" && checkInAudience ? checkInAudience : composerAudience}
        friends={presence.friends}
        lists={lists}
        confirmLabel={sheet === "hold" ? "Send now" : "Use this"}
        onClose={() => setSheet(null)}
        onConfirm={confirmSheet}
      />
    </>
  );
}
