import { useState } from "react";
import type { ReactionKind } from "../../types/api";
import { Icon } from "../icons/Icon";

export const REACTIONS: { kind: Exclude<ReactionKind, "reply">; icon: "wave" | "heart" | "laugh"; label: string }[] = [
  { kind: "wave", icon: "wave", label: "Wave" },
  { kind: "heart", icon: "heart", label: "Heart" },
  { kind: "laugh", icon: "laugh", label: "Laugh" },
];

// FR-S5 / FR-P5: react or reply privately to a friend's update.
export function ReactionBar({ mine, onReact, onReply, name }: {
  mine: ReactionKind | null; onReact: (k: ReactionKind) => void; onReply: (text: string) => Promise<void>; name: string;
}) {
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);

  if (replying) {
    return (
      <form className="reply" onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim()) return;
        await onReply(text);
        setText(""); setReplying(false); setSent(true);
      }}>
        <input autoFocus maxLength={280} value={text} onChange={(e) => setText(e.target.value)}
          placeholder={`Only ${name} will see this`} aria-label={`Private reply to ${name}`} />
        <button className="btn btn--primary btn--small" type="submit">Send</button>
        <button className="btn btn--quiet btn--small" type="button" onClick={() => setReplying(false)}>Cancel</button>
      </form>
    );
  }
  return (
    <div className="reactions">
      {REACTIONS.map((k) => (
        <button key={k.kind} className={`round-btn round-btn--small${mine === k.kind ? " is-on" : ""}`} onClick={() => onReact(k.kind)}
          aria-pressed={mine === k.kind} aria-label={`${k.label} for ${name}`}>
          <Icon name={k.icon} size={20} />
        </button>
      ))}
      <button className="text-btn reactions__reply" onClick={() => setReplying(true)}>
        <Icon name="reply" size={18} />{sent ? "Replied" : "Reply privately"}
      </button>
    </div>
  );
}
