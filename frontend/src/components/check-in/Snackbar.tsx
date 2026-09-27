import { useCountdown } from "../../hooks/useCountdown";
import { Icon } from "../icons/Icon";

const HOLD = 30_000;

// FR-R3: the 30 s delivery hold, a floating pill with Change and Undo. A slim gold line along its
// bottom edge drains over the hold. `frozenLeftMs` pins it for static previews.
export function Snackbar({ deliverAt, audienceLabel, onUndo, onChange, busy, frozenLeftMs }: {
  deliverAt: string | null; audienceLabel: string; onUndo: () => void; onChange: () => void; busy?: boolean; frozenLeftMs?: number;
}) {
  const live = useCountdown(frozenLeftMs === undefined ? deliverAt : null);
  const left = frozenLeftMs ?? live;
  const secs = Math.ceil(left / 1000);
  return (
    <section className="snackbar" aria-label="Update waiting to send">
      <p className="snackbar__text" aria-live="polite">
        {secs > 0 ? <>Sending to {audienceLabel} in <span className="num">{secs}s</span></> : <>Sending to {audienceLabel}…</>}
      </p>
      <button className="text-btn text-btn--gold" onClick={onChange} disabled={busy}>Change</button>
      <button className="text-btn text-btn--gold" onClick={onUndo} disabled={busy}>Undo</button>
      <span className="snackbar__line" style={{ transform: `scaleX(${Math.max(0, left) / HOLD})` }} aria-hidden="true" />
    </section>
  );
}

export function SentPill({ audienceLabel, onDelete, busy }: { audienceLabel: string; onDelete?: () => void; busy?: boolean }) {
  return (
    <section className="snackbar snackbar--sent" aria-label="Update sent">
      <span className="snackbar__icon"><Icon name="check" size={20} /></span>
      <p className="snackbar__text" role="status">Sent to {audienceLabel}. It's on their feed and in iMessage.</p>
      {onDelete && <button className="text-btn" onClick={onDelete} disabled={busy}>Delete</button>}
    </section>
  );
}
