import { Avatar } from "../common/Avatar";
import { Icon } from "../icons/Icon";

export interface Brusher { id: string; name: string }
export interface Drift { key: string; fromId: string; kind: "wave" | "heart" | "laugh" }

// Status zone (read-only): friends brushing now, each in a gold orbit ring. During a Brush Buddy
// overlap the line reads as a live banner, and reactions they send drift up from their avatar.
export function BrushingNowBar({ friends, overlap = false, drifts = [], idleText }: {
  friends: Brusher[]; overlap?: boolean; drifts?: Drift[]; idleText?: string;
}) {
  const text = friends.length === 0 ? (idleText ?? "A quiet sky tonight")
    : friends.length === 1 ? `${friends[0].name} is brushing ${overlap ? "too" : "now"}`
    : `${friends[0].name} and ${friends.length - 1 === 1 ? friends[1].name : `${friends.length - 1} others`} are brushing ${overlap ? "too" : "now"}`;
  return (
    <div className={`now-bar${overlap && friends.length ? " now-bar--live" : ""}`} role="status">
      {friends.length > 0 && (
        <span className="now-bar__faces">
          {friends.slice(0, 4).map((f) => (
            <span key={f.id} className="now-bar__face">
              <Avatar id={f.id} name={f.name} size={34} live />
              {drifts.filter((d) => d.fromId === f.id).map((d) => (
                <span key={d.key} className="drift" aria-hidden="true">
                  <Icon name="sparkle" size={12} className="drift__star" />
                  <Icon name={d.kind} size={16} />
                </span>
              ))}
            </span>
          ))}
        </span>
      )}
      <span className={friends.length ? "now-bar__text" : "now-bar__empty"}>
        {overlap && friends.length > 0 && <span className="now-bar__dot" aria-hidden="true" />}
        {text}
      </span>
    </div>
  );
}
