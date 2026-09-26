import { Avatar } from "../common/Avatar";
import type { CircleMember } from "../../types/api";

// Status zone: who is brushing right now (read-only).
export function BrushingNowBar({ friends }: { friends: CircleMember[] }) {
  return (
    <div className="now-bar" aria-live="polite">
      {friends.length === 0 ? (
        <span className="now-bar__empty">No one else is brushing right now</span>
      ) : (
        <>
          <span className="now-bar__faces">
            {friends.slice(0, 5).map((f) => <Avatar key={f.friend_id} id={f.friend_id} name={f.display_name} size={34} live />)}
          </span>
          <span className="now-bar__text">
            {friends.length === 1 ? `${friends[0].display_name} is brushing` : `${friends.length} friends brushing`}
          </span>
        </>
      )}
    </div>
  );
}
