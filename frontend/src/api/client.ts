// Typed wrappers around the Supabase RPCs in supabase/migrations/*_functions.sql.
// Reads go through RLS; every state change goes through an RPC that enforces the PRD rules.
import { supabase } from "../lib/supabase";
import type { Mood, Scope } from "../types/moods";
import type {
  Audience, BrushSession, CheckIn, CircleMember, FeedItem, FriendList, Me, Reaction, ReactionKind, ReceivedReaction, Settings,
} from "../types/api";

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

function audienceArgs(a: Audience | null | undefined) {
  return {
    p_audience_type: a?.type ?? null,
    p_list_id: a?.type === "list" ? a.listId ?? null : null,
    p_friend_ids: a?.type === "custom" ? a.friendIds ?? [] : null,
  };
}

export const api = {
  // Account
  getMe: () => rpc<Me | null>("get_me"),
  completeOnboarding: (displayName: string, timezone: string, brushTimes: string[]) =>
    rpc<Me>("complete_onboarding", { p_display_name: displayName, p_timezone: timezone, p_brush_times: brushTimes }),
  updateSettings: async (patch: Partial<Omit<Settings, "onboarded_at">>, userId: string) => {
    const { error } = await supabase.from("user_settings").update(patch).eq("user_id", userId);
    if (error) throw new Error(error.message);
  },
  updateDisplayName: async (name: string, userId: string) => {
    const { error } = await supabase.from("profiles").update({ display_name: name.trim() }).eq("id", userId);
    if (error) throw new Error(error.message);
  },
  exportData: () => rpc<unknown>("export_my_data"),
  deleteAccount: () => rpc<void>("delete_my_account"),

  // Sessions
  startSession: () => rpc<BrushSession>("start_session", { p_channel: "web" }),
  endSession: (id: string) => rpc<BrushSession>("end_session", { p_session_id: id }),
  activeSession: async (userId: string) => {
    const { data, error } = await supabase
      .from("brush_sessions").select("*")
      .eq("user_id", userId).eq("status", "active").gt("ends_at", new Date().toISOString())
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data as BrushSession | null;
  },
  runDueJobs: () => rpc<void>("run_due_jobs"),

  // Check-ins
  postCheckIn: (mood: Mood, scope: Scope, text: string, audience?: Audience | null) =>
    rpc<CheckIn>("post_check_in", { p_mood: mood, p_scope: scope, p_text: text || null, ...audienceArgs(audience) }),
  setAudience: (id: string, audience: Audience, makeDefault = false) =>
    rpc<CheckIn>("set_check_in_audience", { p_id: id, ...audienceArgs(audience), p_make_default: makeDefault }),
  undoCheckIn: (id: string) => rpc<CheckIn>("undo_check_in", { p_id: id }),
  deleteCheckIn: (id: string) => rpc<void>("delete_check_in", { p_id: id }),
  editCheckIn: (id: string, text: string) => rpc<CheckIn>("edit_check_in", { p_id: id, p_text: text }),
  myCheckIns: async (limit = 20) => {
    const me = await rpc<string>("me");
    const { data, error } = await supabase
      .from("check_ins").select("*").eq("user_id", me)
      .in("status", ["held", "delivered"]).order("created_at", { ascending: false }).limit(limit);
    if (error) throw new Error(error.message);
    return data as CheckIn[];
  },
  recipientCount: async (checkInId: string) => {
    const { count, error } = await supabase
      .from("check_in_recipients").select("*", { count: "exact", head: true }).eq("check_in_id", checkInId);
    if (error) throw new Error(error.message);
    return count ?? 0;
  },

  // Reading
  feed: (days = 14) => rpc<FeedItem[]>("get_feed", { p_days: days }),
  markSeen: (ids: string[]) => rpc<void>("mark_seen", { p_ids: ids }),
  circle: () => rpc<CircleMember[]>("get_circle"),
  reactionsToMe: async (since: string) => {
    const me = await rpc<string>("me");
    const { data, error } = await supabase
      .from("reactions").select("*").eq("to_user", me).gt("created_at", since).order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data as Reaction[];
  },

  // Circle
  inviteFriend: (phone: string, name: string) =>
    rpc<{ friend_id: string; status: "pending" | "accepted" | "already_friends"; texted: boolean }>(
      "invite_friend", { p_phone: phone, p_name: name }),
  createInviteLink: () => rpc<string>("create_invite_link"),
  getInvite: async (token: string) => (await rpc<{ inviter_name: string }[]>("get_invite", { p_token: token }))[0] ?? null,
  acceptInvite: (token: string) => rpc<string>("accept_invite", { p_token: token }),
  respondToFriend: (friendId: string, accept: boolean) => rpc<void>("respond_to_friend", { p_friend: friendId, p_accept: accept }),
  removeFriend: (friendId: string) => rpc<void>("remove_friend", { p_friend: friendId }),
  blockFriend: (friendId: string) => rpc<void>("block_friend", { p_friend: friendId }),

  // Reactions
  react: (checkInId: string, kind: ReactionKind, text?: string) =>
    rpc<Reaction>("send_reaction", { p_check_in: checkInId, p_kind: kind, p_text: text ?? null }),
  // Replies and reactions friends sent to my updates, newest first, with their names.
  myReactions: (days = 14) => rpc<ReceivedReaction[]>("get_my_reactions", { p_days: days }),

  // Lists (RLS: owner only)
  lists: async () => {
    const { data, error } = await supabase
      .from("friend_lists").select("id, name, letter, friend_list_members(friend_id)").order("letter");
    if (error) throw new Error(error.message);
    return (data ?? []).map((l) => ({
      id: l.id, name: l.name, letter: l.letter,
      members: (l.friend_list_members as { friend_id: string }[]).map((m) => m.friend_id),
    })) as FriendList[];
  },
  createList: async (name: string, memberIds: string[]) => {
    const { data, error } = await supabase.from("friend_lists").insert({ name: name.trim() }).select("id").single();
    if (error) throw new Error(error.message.includes("friend_lists_owner_name") ? "You already have a list with that name." : error.message);
    if (memberIds.length) await api.setListMembers(data.id, [], memberIds);
    return data.id as string;
  },
  renameList: async (id: string, name: string) => {
    const { error } = await supabase.from("friend_lists").update({ name: name.trim() }).eq("id", id);
    if (error) throw new Error(error.message);
  },
  deleteList: async (id: string) => {
    const { error } = await supabase.from("friend_lists").delete().eq("id", id);
    if (error) throw new Error(error.message);
  },
  setListMembers: async (listId: string, before: string[], after: string[]) => {
    const add = after.filter((f) => !before.includes(f));
    const remove = before.filter((f) => !after.includes(f));
    if (add.length) {
      const { error } = await supabase.from("friend_list_members").insert(add.map((friend_id) => ({ list_id: listId, friend_id })));
      if (error) throw new Error(error.message);
    }
    if (remove.length) {
      const { error } = await supabase.from("friend_list_members").delete().eq("list_id", listId).in("friend_id", remove);
      if (error) throw new Error(error.message);
    }
  },
};
