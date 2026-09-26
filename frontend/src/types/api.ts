import type { Mood, Scope } from "./moods";

export type Channel = "imessage" | "whatsapp" | "sms" | "web";
export type AudienceType = "everyone" | "list" | "custom";
export type AudienceLabel = "everyone" | "close_circle" | "just_for_you";
export type ReactionKind = "wave" | "heart" | "laugh" | "reply";

export interface Settings {
  timezone: string;
  brush_times: string[];
  quiet_start: string;
  quiet_end: string;
  invisible: boolean;
  dominant_hand: "left" | "right";
  preferred_channel: Channel;
  default_list_id: string | null;
  presence_list_id: string | null;
  onboarded_at: string | null;
}

export interface Me {
  id: string;
  display_name: string;
  status: "guest" | "active";
  email: string | null;
  phone: string | null;
  settings: Settings;
}

export interface BrushSession {
  id: string;
  user_id: string;
  channel: Channel;
  started_at: string;
  ends_at: string;
  ended_at: string | null;
  status: "active" | "completed" | "abandoned";
}

export interface CheckIn {
  id: string;
  user_id: string;
  session_id: string | null;
  mood: Mood;
  scope: Scope;
  text: string | null;
  audience_type: AudienceType;
  list_id: string | null;
  friend_ids: string[];
  status: "held" | "delivered" | "undone" | "deleted";
  deliver_at: string;
  delivered_at: string | null;
  created_at: string;
  edited_at: string | null;
}

export interface Audience {
  type: AudienceType;
  listId?: string | null;
  friendIds?: string[];
}

export interface FeedItem {
  check_in_id: string;
  author_id: string;
  author_name: string;
  mood: Mood;
  scope: Scope;
  text: string | null;
  audience_label: AudienceLabel;
  delivered_at: string;
  edited_at: string | null;
  seen_at: string | null;
  my_reaction: ReactionKind | null;
}

export interface CircleMember {
  friend_id: string;
  display_name: string;
  friendship_status: "pending" | "accepted";
  requested_by_me: boolean;
  is_guest: boolean;
  brushing_now: boolean;
  latest_check_in_id: string | null;
  latest_mood: Mood | null;
  latest_scope: Scope | null;
  latest_text: string | null;
  latest_audience_label: AudienceLabel | null;
  latest_at: string | null;
}

export interface FriendList {
  id: string;
  name: string;
  letter: string;
  members: string[];
}

export interface Reaction {
  id: string;
  from_user: string;
  to_user: string;
  check_in_id: string | null;
  kind: ReactionKind;
  text: string | null;
  created_at: string;
}

// A reply or reaction a friend sent to one of my updates (public.get_my_reactions).
export interface ReceivedReaction {
  id: string;
  from_user: string;
  from_name: string;
  kind: ReactionKind;
  text: string | null;
  check_in_id: string | null;
  check_in_mood: Mood | null;
  check_in_text: string | null;
  created_at: string;
}
