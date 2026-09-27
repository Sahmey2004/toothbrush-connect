import { Icon } from "../icons/Icon";
import { REACTIONS } from "./ReactionBar";

// FR-P5: during a Brush Buddy overlap, three round reaction buttons sit in the utility zone.
export function OverlapReactions({ name, onReact, sent }: {
  name: string; onReact: (kind: "wave" | "heart" | "laugh") => void; sent?: string | null;
}) {
  return (
    <div className="overlap" role="group" aria-label={`React to ${name}`}>
      {REACTIONS.map((r) => (
        <button key={r.kind} className={`round-btn${sent === r.kind ? " is-on" : ""}`} onClick={() => onReact(r.kind)}
          aria-label={`Send ${name} a ${r.label.toLowerCase()}`}>
          <Icon name={r.icon} />
        </button>
      ))}
    </div>
  );
}
