// The brush screen, split into the PRD's portrait zones. Presentational only: the live page
// (pages/Brush.tsx) and the design gallery (pages/DesignSheet.tsx) both render it.
//   Status   (top ~10%)     read-only: who is brushing now
//   Display  (10–55%)       read-only: the moon timer and friends' check-in cards
//   Action   (55–90%)       audience chip, 2×2 moods, Today / This week, Add a line
//   Utility  (bottom ~10%)  End, overlap reactions, the post-tap snackbar
import type { ReactNode } from "react";
import type { Mood, Scope } from "../../types/moods";
import type { FeedItem } from "../../types/api";
import { joinNames } from "../../lib/labels";
import { BrushMoon } from "../timer/BrushMoon";
import { StartButton } from "../timer/StartButton";
import { FriendCard } from "../feed/FriendCard";
import { MoodChips } from "../check-in/MoodChips";
import { ScopeToggle } from "../check-in/ScopeToggle";
import { AddLine } from "../check-in/AddLine";
import { AudienceChip } from "../check-in/AudienceChip";
import { BrushingNowBar, type Brusher, type Drift } from "../presence/BrushingNowBar";
import { OverlapReactions } from "../presence/OverlapReactions";
import { Avatar } from "../common/Avatar";
import { ErrorNote } from "../common/ErrorNote";
import { Icon } from "../icons/Icon";

export type BrushPhase = "idle" | "active" | "done";

export interface BrushScreenProps {
  phase: BrushPhase;
  elapsedMs: number;
  hand?: "left" | "right";
  brushingNow: Brusher[];
  drifts?: Drift[];
  cards: FeedItem[];
  moreCount?: number;
  // composer
  audienceLabel: string;
  scope: Scope;
  line: string;
  lineOpen?: boolean;
  selectedMood: Mood | null;
  moodsLocked?: boolean;
  pressedMood?: Mood | null;
  // utility
  snackbar?: ReactNode;
  reactionSent?: string | null;
  // done
  caughtUp?: Brusher[];
  doneNote?: string;
  // overlays
  sheet?: ReactNode;
  starting?: boolean;
  busy?: boolean;
  error?: string | null;
  onStart?: () => void;
  onEnd?: () => void;
  onDismissDone?: () => void;
  onPickMood?: (m: Mood) => void;
  onScope?: (s: Scope) => void;
  onLine?: (v: string) => void;
  onOpenAudience?: () => void;
  onReact?: (kind: "wave" | "heart" | "laugh") => void;
  displayProps?: React.HTMLAttributes<HTMLDivElement>;
}

const noop = () => {};

export function BrushScreen(p: BrushScreenProps) {
  const inSession = p.phase === "active";
  const overlap = inSession && p.brushingNow.length > 0;

  const status = (
    <BrushingNowBar friends={p.brushingNow} overlap={overlap} drifts={p.drifts}
      idleText={p.phase === "done" ? "Landed. Sleep well." : undefined} />
  );

  const display = (
    <>
      <BrushMoon elapsedMs={p.elapsedMs} mode={p.phase} />
      {p.phase === "done" ? (
        <section className="summary" aria-label="Session summary">
          <p className="summary__line">
            {p.caughtUp && p.caughtUp.length > 0
              ? <>You caught up with {joinNames(p.caughtUp.map((f) => f.name))}</>
              : <>Clean teeth, clear head.</>}
          </p>
          {p.caughtUp && p.caughtUp.length > 0 && (
            <ul className="summary__cards">
              {p.caughtUp.map((f) => (
                <li key={f.id} className="summary__card"><Avatar id={f.id} name={f.name} size={30} />{f.name}</li>
              ))}
            </ul>
          )}
        </section>
      ) : inSession && p.cards.length > 0 && (
        <div className="cards-rail" role="region" aria-label="Friends' latest updates" tabIndex={0}>
          {p.cards.map((c) => <FriendCard key={c.check_in_id} item={c} compact />)}
          {!!p.moreCount && <p className="cards-rail__more">+{p.moreCount} more in your feed</p>}
        </div>
      )}
    </>
  );

  let action: ReactNode;
  if (p.phase === "idle") {
    action = <StartButton onStart={p.onStart ?? noop} busy={!!p.starting} friendsBrushing={p.brushingNow.map((f) => f.name)} />;
  } else if (p.phase === "done") {
    action = (
      <div className="done-actions">
        {p.doneNote && <p className="done-actions__note">{p.doneNote}</p>}
        <button className="btn btn--primary btn--big" onClick={p.onDismissDone}>Back to the sky</button>
      </div>
    );
  } else {
    action = (
      <div className="composer">
        <AudienceChip label={p.audienceLabel} onOpen={p.onOpenAudience ?? noop} />
        <MoodChips onPick={p.onPickMood ?? noop} disabled={p.busy || p.moodsLocked} selected={p.selectedMood} pressed={p.pressedMood} />
        <div className="composer__row">
          <ScopeToggle value={p.scope} onChange={p.onScope ?? noop} compact={!!p.lineOpen || p.line.length > 0} />
          <AddLine value={p.line} onChange={p.onLine ?? noop} open={p.lineOpen} />
        </div>
      </div>
    );
  }

  const utility = inSession ? (
    p.snackbar ?? (
      <div className="utility-row">
        {overlap && <OverlapReactions name={p.brushingNow[0].name} onReact={p.onReact ?? noop} sent={p.reactionSent} />}
        <button className="end-btn" onClick={p.onEnd}>
          <Icon name="land" size={20} />End<span className="visually-hidden"> session (or swipe down on the moon)</span>
        </button>
      </div>
    )
  ) : null;

  return (
    <div className={`bscreen bscreen--${p.phase} hand-${p.hand ?? "right"}`}>
      <header className="zone zone--status">{status}</header>
      <section className="zone zone--display" aria-label="Brush timer" {...p.displayProps}>{display}</section>
      <section className="zone zone--action" aria-label={p.phase === "idle" ? "Start" : "Your check-in"}>
        {action}
        <ErrorNote error={p.error ?? null} />
      </section>
      {utility && <footer className="zone zone--utility">{utility}</footer>}
      {p.sheet}
    </div>
  );
}
