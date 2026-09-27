import { useCallback, useEffect, useState } from "react";
import { api } from "../../api/client";
import { supabase } from "../../lib/supabase";
import { timeAgo } from "../../lib/labels";
import { moodInfo } from "../../types/moods";
import type { ReceivedReaction } from "../../types/api";

const VERB: Record<string, string> = { heart: "loved", laugh: "laughed at", wave: "waved 👋 at" };
const EMOJI: Record<string, string> = { heart: "❤️", laugh: "😂", wave: "👋", reply: "💬" };

// Replies and reactions friends sent to your updates (get_my_reactions), live as they arrive.
export function PopReplies({ myId }: { myId: string }) {
  const [items, setItems] = useState<ReceivedReaction[]>([]);
  const refresh = useCallback(() => { api.myReactions().then(setItems).catch(() => {}); }, []);

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
    <section className="pop-replies">
      <h2 className="pop-day__title">Replies to you</h2>
      <div className="pop-replies__list">
        {items.map((r) => {
          const about = r.check_in_text
            ? `“${r.check_in_text}”`
            : r.check_in_mood ? `${moodInfo(r.check_in_mood).emoji} update` : "your update";
          return (
            <div key={r.id} className="pop-reply">
              <span className="pop-reply__emoji" aria-hidden="true">{EMOJI[r.kind] ?? "💬"}</span>
              <div className="pop-reply__body">
                <p className="pop-reply__line">
                  <span className="pop-reply__who">{r.from_name || "A friend"}</span>{" "}
                  {r.kind === "reply" ? <>replied to {about}</> : <>{VERB[r.kind] ?? "reacted to"} {about}</>}
                  <span className="pop-reply__time"> · {timeAgo(r.created_at)}</span>
                </p>
                {r.kind === "reply" && r.text && <p className="pop-reply__text">“{r.text}”</p>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
