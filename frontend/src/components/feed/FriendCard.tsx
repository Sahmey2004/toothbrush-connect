import { useState } from "react";
import { checkInLabel, timeAgo } from "../../lib/labels";
import { api } from "../../api/client";
import type { FeedItem, ReactionKind } from "../../types/api";
import { ReactionBar } from "../presence/ReactionBar";

export function FriendCard({ item }: { item: FeedItem }) {
  const [mine, setMine] = useState<ReactionKind | null>(item.my_reaction);
  const react = async (k: ReactionKind) => {
    const before = mine;
    setMine(k);
    await api.react(item.check_in_id, k).catch(() => setMine(before));
  };
  return (
    <article className={`card card--${item.mood}`}>
      <header className="card__head">
        <span className="label">[{checkInLabel(item.mood, item.scope, item.audience_label)}]</span>
        <time className="card__time" dateTime={item.delivered_at}>{timeAgo(item.delivered_at)}</time>
      </header>
      <p className="card__author">{item.author_name}</p>
      {item.text && <p className="card__text">“{item.text}”{item.edited_at && <span className="card__edited"> edited</span>}</p>}
      <ReactionBar mine={mine} onReact={react} onReply={async (t) => { await api.react(item.check_in_id, "reply", t); }} />
    </article>
  );
}
