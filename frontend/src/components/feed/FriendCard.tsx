import { useState } from "react";
import { audienceText, timeAgo } from "../../lib/labels";
import { api } from "../../api/client";
import { moodInfo, scopeLabel } from "../../types/moods";
import type { FeedItem, ReactionKind } from "../../types/api";
import { MoodIcon } from "../icons/Icon";
import { Avatar } from "../common/Avatar";
import { ReactionBar } from "../presence/ReactionBar";

export function MoodBadge({ mood }: { mood: FeedItem["mood"] }) {
  return (
    <span className={`mood-badge mood-tone--${mood}`}>
      <MoodIcon mood={mood} size={18} />
      {moodInfo(mood).label}
    </span>
  );
}

// A friend's check-in: name, mood icon and label, optional line, scope and audience badges.
// `compact` is the swipeable card in the session's display zone (read-only).
export function FriendCard({ item, compact = false, onReact }: {
  item: FeedItem; compact?: boolean; onReact?: (k: ReactionKind, text?: string) => Promise<void>;
}) {
  const [mine, setMine] = useState<ReactionKind | null>(item.my_reaction);
  const react = async (k: ReactionKind) => {
    const before = mine;
    setMine(k);
    await (onReact ? onReact(k) : api.react(item.check_in_id, k)).catch(() => setMine(before));
  };
  const reply = async (t: string) => { await (onReact ? onReact("reply", t) : api.react(item.check_in_id, "reply", t)); };

  const badges = (
    <span className="fcard__badges">
      <span className="badge">{scopeLabel(item.scope)}</span>
      <span className={`badge${item.audience_label === "just_for_you" ? " badge--warm" : ""}`}>{audienceText(item.audience_label)}</span>
    </span>
  );

  if (compact) {
    return (
      <article className="fcard fcard--compact" aria-label={`${item.author_name}: ${moodInfo(item.mood).label}`}>
        <header className="fcard__head">
          <Avatar id={item.author_id} name={item.author_name} size={26} />
          <p className="fcard__name">{item.author_name}</p>
          <MoodBadge mood={item.mood} />
        </header>
        <p className="fcard__line">
          <span className="fcard__text">{item.text ?? <span className="muted">No note</span>}</span>
          {badges}
        </p>
      </article>
    );
  }

  return (
    <article className="fcard" aria-label={`${item.author_name}: ${moodInfo(item.mood).label}`}>
      <header className="fcard__head">
        <Avatar id={item.author_id} name={item.author_name} size={36} />
        <p className="fcard__name">{item.author_name}</p>
        <time className="fcard__time" dateTime={item.delivered_at}>{timeAgo(item.delivered_at)}</time>
      </header>
      <MoodBadge mood={item.mood} />
      {item.text && (
        <p className="fcard__text fcard__text--full">
          {item.text}{item.edited_at && <span className="fcard__edited"> edited</span>}
        </p>
      )}
      {badges}
      <ReactionBar mine={mine} onReact={react} onReply={reply} name={item.author_name} />
    </article>
  );
}
