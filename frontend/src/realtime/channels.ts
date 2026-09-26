// Supabase Realtime replaces the old WebSocket presence service. Row-level security is applied
// per subscriber, so a user only hears about sessions of friends whose presence audience includes
// them, check-ins delivered to them, and reactions to their own updates.
import { supabase } from "../lib/supabase";
import type { BrushSession } from "../types/api";

export interface RealtimeHandlers {
  onFriendSession?: (s: BrushSession, event: "INSERT" | "UPDATE") => void;
  onDelivered?: () => void;
  onReaction?: () => void;
  onCircleChange?: () => void;
}

export function subscribeToCircle(myId: string, h: RealtimeHandlers) {
  const channel = supabase
    .channel(`circle:${myId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "brush_sessions" }, (p) => {
      const row = p.new as BrushSession;
      if (row?.user_id && row.user_id !== myId && (p.eventType === "INSERT" || p.eventType === "UPDATE")) {
        h.onFriendSession?.(row, p.eventType);
      }
    })
    .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "check_in_recipients", filter: `recipient_id=eq.${myId}` },
      () => h.onDelivered?.())
    .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "reactions", filter: `to_user=eq.${myId}` },
      () => h.onReaction?.())
    .on("postgres_changes", { event: "*", schema: "public", table: "friendships" }, () => h.onCircleChange?.())
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}
