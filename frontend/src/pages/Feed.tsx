import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { PopReplies } from "../components/feed/PopReplies";
import { usePresence } from "../hooks/usePresence";
import { checkInLabel, timeAgo } from "../lib/labels";
import type { FeedItem, ReactionKind } from "../types/api";
import "../styles/pop.css";

const dayKey = (iso: string) => new Date(iso).toDateString();
const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
};

const REACTIONS: { kind: ReactionKind; emoji: string; label: string }[] = [
  { kind: "wave", emoji: "👋", label: "Wave back" },
  { kind: "heart", emoji: "❤️", label: "Send a heart" },
  { kind: "laugh", emoji: "😂", label: "Laugh" },
];

function Reactions({ item }: { item: FeedItem }) {
  const [mine, setMine] = useState<ReactionKind | null>(item.my_reaction);
  const react = async (kind: ReactionKind) => {
    const before = mine;
    setMine(kind);
    await api.react(item.check_in_id, kind).catch(() => setMine(before));
  };
  return (
    <div className="pop-react">
      {REACTIONS.map((r) => (
        <button
          key={r.kind}
          type="button"
          className={"pop-react__btn" + (mine === r.kind ? " is-on" : "")}
          onClick={() => react(r.kind)}
          aria-pressed={mine === r.kind}
          aria-label={r.label}
        >
          {r.emoji}
        </button>
      ))}
    </div>
  );
}

function Card({ item }: { item: FeedItem }) {
  return (
    <article className={`pop-fcard pop-fcard--${item.mood}`}>
      <div className="pop-fcard__head">
        <span className="pop-fcard__label">{checkInLabel(item.mood, item.scope, item.audience_label)}</span>
        <time className="pop-fcard__time" dateTime={item.delivered_at}>{timeAgo(item.delivered_at)}</time>
      </div>
      <p className="pop-fcard__author">{item.author_name}</p>
      {item.text && (
        <p className="pop-fcard__text">
          “{item.text}”{item.edited_at && <span className="pop-fcard__edited"> · edited</span>}
        </p>
      )}
      <Reactions item={item} />
    </article>
  );
}

export default function Feed() {
  const { me } = useAuth();
  const { feed, loaded } = usePresence(me?.id);
  const location = useLocation();
  const [sent, setSent] = useState(() => !!(location.state as { justSent?: boolean } | null)?.justSent);
  useEffect(() => {
    if (!sent) return;
    const t = setTimeout(() => setSent(false), 3200);
    return () => clearTimeout(t);
  }, [sent]);
  const groups = feed.reduce<Map<string, FeedItem[]>>((acc, item) => {
    const k = dayKey(item.delivered_at);
    acc.set(k, [...(acc.get(k) ?? []), item]);
    return acc;
  }, new Map());

  return (
    <>
      {sent && <div className="pop-toast" role="status">Sent to your circle ✓</div>}
      <header className="pop-feed__head">
        <h1 className="pop-feed__title">Updates</h1>
        <p className="pop-feed__sub">The last 14 days from your circle.</p>
      </header>
      {me && <PopReplies myId={me.id} />}
      {loaded && feed.length === 0 && (
        <p className="pop-empty">No updates yet.<br />They'll land here after your friends brush. 🌙</p>
      )}
      {[...groups.entries()].map(([k, items]) => (
        <section key={k} className="pop-day">
          <h2 className="pop-day__title">{dayLabel(items[0].delivered_at)}</h2>
          {items.map((item) => <Card key={item.check_in_id} item={item} />)}
        </section>
      ))}
    </>
  );
}
