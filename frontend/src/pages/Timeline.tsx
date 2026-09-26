import { useAuth } from "../auth/AuthProvider";
import { usePresence } from "../hooks/usePresence";
import { FriendCard } from "../components/feed/FriendCard";
import type { FeedItem } from "../types/api";

const dayKey = (iso: string) => new Date(iso).toDateString();
const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
};

// FR-S4: 14 days of updates the viewer received, and nothing else.
export default function Timeline() {
  const { me } = useAuth();
  const { feed, loaded } = usePresence(me?.id);
  const groups = feed.reduce<Map<string, FeedItem[]>>((acc, item) => {
    const k = dayKey(item.delivered_at);
    acc.set(k, [...(acc.get(k) ?? []), item]);
    return acc;
  }, new Map());

  return (
    <div className="page">
      <h1 className="page-title">Updates</h1>
      <p className="hint">The last 14 days of updates sent to you.</p>
      {loaded && feed.length === 0 && <p className="empty">No updates yet. They'll show up here after your friends brush.</p>}
      {[...groups.entries()].map(([k, items]) => (
        <section key={k} className="day">
          <h2 className="day__title">{dayLabel(items[0].delivered_at)}</h2>
          <div className="cards">
            {items.map((item) => <FriendCard key={item.check_in_id} item={item} />)}
          </div>
        </section>
      ))}
    </div>
  );
}
