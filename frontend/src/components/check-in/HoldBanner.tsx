import { useCountdown } from "../../hooks/useCountdown";
import { moodInfo } from "../../types/moods";
import type { CheckIn } from "../../types/api";

// FR-R2: the 30 s delivery hold, with Undo and Choose who.
export function HoldBanner({ checkIn, audienceLabel, onUndo, onChoose, busy }: {
  checkIn: CheckIn; audienceLabel: string; onUndo: () => void; onChoose: () => void; busy: boolean;
}) {
  const left = useCountdown(checkIn.deliver_at);
  const secs = Math.ceil(left / 1000);
  const m = moodInfo(checkIn.mood);
  return (
    <section className="hold" aria-live="polite">
      <div className="hold__fill" style={{ transform: `scaleX(${left / 30_000})` }} aria-hidden />
      <p className="hold__label">✅ POSTED · {m.word}</p>
      <p className="hold__line">
        {secs > 0 ? <>Sending to {audienceLabel} in {secs}s</> : <>Sending to {audienceLabel}…</>}
      </p>
      {checkIn.text && <p className="hold__text">“{checkIn.text}”</p>}
      <div className="hold__actions">
        <button className="btn btn--quiet" onClick={onUndo} disabled={busy}>Undo</button>
        <button className="btn btn--primary" onClick={onChoose} disabled={busy}>Choose who</button>
      </div>
    </section>
  );
}
