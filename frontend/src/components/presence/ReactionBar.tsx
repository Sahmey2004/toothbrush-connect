import { useState } from "react";
import type { ReactionKind } from "../../types/api";

const KINDS: { kind: ReactionKind; emoji: string; label: string }[] = [
  { kind: "heart", emoji: "❤️", label: "Love" },
  { kind: "laugh", emoji: "😂", label: "Laugh" },
  { kind: "wave", emoji: "👋", label: "Wave" },
];

// FR-P5 / FR-M8: react or reply privately to a friend's update.
export function ReactionBar({ mine, onReact, onReply }: {
  mine: ReactionKind | null; onReact: (k: ReactionKind) => void; onReply: (text: string) => Promise<void>;
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
        <input autoFocus maxLength={280} value={text} onChange={(e) => setText(e.target.value)} placeholder="Only they will see this" aria-label="Private reply" />
        <button className="btn btn--primary btn--small" type="submit">Send</button>
        <button className="btn btn--quiet btn--small" type="button" onClick={() => setReplying(false)}>Cancel</button>
      </form>
    );
  }
  return (
    <div className="reactions">
      {KINDS.map((k) => (
        <button key={k.kind} className={`reaction${mine === k.kind ? " is-on" : ""}`} onClick={() => onReact(k.kind)}
          aria-pressed={mine === k.kind} aria-label={k.label}>
          {k.emoji}
        </button>
      ))}
      <button className="reaction reaction--reply" onClick={() => setReplying(true)}>{sent ? "Replied" : "Reply"}</button>
    </div>
  );
}
