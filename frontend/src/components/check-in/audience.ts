import type { Audience, CircleMember, FriendList } from "../../types/api";

export function describeAudience(a: Audience, friends: CircleMember[], lists: FriendList[]) {
  if (a.type === "list") {
    const l = lists.find((x) => x.id === a.listId);
    return l ? `${l.name} (${l.members.length})` : "A list";
  }
  if (a.type === "custom") {
    const names = friends.filter((f) => a.friendIds?.includes(f.friend_id)).map((f) => f.display_name);
    if (names.length <= 2) return `${names.join(" and ")} only`;
    return `${names.length} friends`;
  }
  return `Everyone (${friends.length})`;
}
