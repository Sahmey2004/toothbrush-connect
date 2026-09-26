import { useCallback, useEffect, useState } from "react";
import { api } from "../../api/client";
import { supabase } from "../../lib/supabase";
import { timeAgo } from "../../lib/labels";
import { moodInfo } from "../../types/moods";
import type { ReceivedReaction } from "../../types/api";

const VERB: Record<string, string> = {
  heart: "loved",
  laugh: "laughed at",
  wave: "waved 👋 at",
};
const EMOJI: Record<string, string> = { heart: "❤️", laugh: "😂", wave: "👋", reply: "💬" };

// Replies and reactions friends sent to my updates. Updates live when a new one arrives.
export function RepliesToMe({ myId }: { myId: string }) {
  const [items, setItems] = useState<ReceivedReaction[]>([]);

  const refresh = useCallback(() => {
    api.myReactions().then(setItems).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const channel = supabase
      .channel(`reactions:${myId}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "reactions", filter: `to_user=eq.${myId}` },
        () => refresh())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [myId, refresh]);

  if (items.length === 0) return null;

  return (
    <section className="panel">
      <h2 className="section-title">Replies to you</h2>
      <ul className="cards" style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {items.map((r) => {
          const about = r.check_in_text
            ? `“${r.check_in_text}”`
            : r.check_in_mood ? `${moodInfo(r.check_in_mood).emoji} update` : "you";
          return (
            <li key={r.id}>
              <p>
                <span aria-hidden="true">{EMOJI[r.kind] ?? "💬"} </span>
                <strong>{r.from_name || "A friend"}</strong>{" "}
                {r.kind === "reply" ? <>replied to {about}</> : <>{VERB[r.kind] ?? "reacted to"} {about}</>}
                <span className="hint"> · {timeAgo(r.created_at)}</span>
              </p>
              {r.kind === "reply" && r.text && <p style={{ margin: "0.2rem 0 0 1.6rem" }}>{r.text}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
