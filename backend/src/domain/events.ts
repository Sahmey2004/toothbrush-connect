// Real-time WebSocket events. Keep in sync with frontend/src/types/events.ts.
export type ClientEvent =
  | { type: "session.start"; sessionId: string }
  | { type: "session.heartbeat"; sessionId: string }
  | { type: "session.end"; sessionId: string };

export type ServerEvent =
  | { type: "friend.brushing_started"; friendId: string }
  | { type: "friend.brushing_ended"; friendId: string }
  | { type: "overlap.started"; friendIds: string[] }
  | { type: "check_in.delivered"; checkInId: string; audienceLabel: "everyone" | "close_circle" | "just_for_you" }
  | { type: "reaction.received"; reactionId: string };
