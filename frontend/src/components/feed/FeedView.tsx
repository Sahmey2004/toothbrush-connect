import { Link } from "react-router-dom";
import type { FeedItem, ReactionKind } from "../../types/api";
import { Icon } from "../icons/Icon";
import { Avatar } from "../common/Avatar";
import { FriendCard } from "./FriendCard";
import type { Brusher } from "../presence/BrushingNowBar";

const dayKey = (iso: string) => new Date(iso).toDateString();
const dayLabel = (iso: string) => {
  const d = new Date(iso);
  if (d.toDateString() === new Date().toDateString()) return "Tonight";
  if (d.toDateString() === new Date(Date.now() - 86_400_000).toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
};

// FR-S3 / FR-S4: check-ins sent to you in the last 14 days, newest first, grouped by day.
export function FeedView({ feed, loaded, brushingNow = [], onReact }: {
  feed: FeedItem[]; loaded: boolean; brushingNow?: Brusher[];
  onReact?: (item: FeedItem, k: ReactionKind, text?: string) => Promise<void>;
}) {
  const groups = feed.reduce<Map<string, FeedItem[]>>((acc, item) => {
    const k = dayKey(item.delivered_at);
    acc.set(k, [...(acc.get(k) ?? []), item]);
    return acc;
  }, new Map());

  return (
    <div className="page feed">
      <header className="page-head">
        <h1 className="page-title">Feed</h1>
        <p className="hint"><Icon name="check" size={16} /> Updates also arrive in iMessage</p>
      </header>
      {brushingNow.length > 0 && (
        <Link className="live-card" to="/brush">
          <Avatar id={brushingNow[0].id} name={brushingNow[0].name} size={36} live />
          <span className="live-card__text"><strong>{brushingNow[0].name}</strong> is brushing now</span>
          <span className="live-card__cta">Join <Icon name="arc-up" size={18} /></span>
        </Link>
      )}
      {loaded && feed.length === 0 && <p className="empty">No updates yet. They'll show up here after your friends brush.</p>}
      {[...groups.entries()].map(([k, items]) => (
        <section key={k} className="day" aria-labelledby={`day-${k.replace(/\W/g, "")}`}>
          <h2 id={`day-${k.replace(/\W/g, "")}`} className="day__title">{dayLabel(items[0].delivered_at)}</h2>
          <div className="day__cards">
            {items.map((item) => (
              <FriendCard key={item.check_in_id} item={item} onReact={onReact ? (k2, t) => onReact(item, k2, t) : undefined} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
