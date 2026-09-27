import { useEffect, useRef, useState } from "react";
import { photonVerifyLink, startPhoneVerification } from "../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { formatPhone } from "../../lib/phone";
import { ErrorNote } from "../common/ErrorNote";

// Link a phone number by texting the Photon line: the text proves the number, and Photon can
// message it from then on (shared lines only message numbers that texted first).
export function PhoneVerify({ compact = false }: { compact?: boolean }) {
  const { me, refreshMe } = useAuth();
  const [phone, setPhone] = useState("");
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState(false);
  const [justVerified, setJustVerified] = useState(false);

  const pending = me?.phone_verification ?? null;
  const waiting = !!pending && !changing;

  // Watch for the agent to receive the text.
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => refreshMe().catch(() => {}), 3000);
    return () => clearInterval(t);
  }, [waiting, refreshMe]);

  // Celebrate when a wait ends in a verified number.
  const wasWaiting = useRef(false);
  useEffect(() => {
    if (wasWaiting.current && me?.phone && !pending) setJustVerified(true);
    wasWaiting.current = waiting;
  }, [waiting, me?.phone, pending]);

  if (!me) return null;

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await startPhoneVerification(phone);
      setDryRun(r.dry_run);
      setChanging(false);
      await refreshMe();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (me.phone && !changing && !pending) {
    return (
      <div className={`phone-card is-done${compact ? " is-compact" : ""}`}>
        <p className="phone-card__title">{justVerified ? "✅ You're connected!" : "✅ iMessage connected"}</p>
        <p className="phone-card__line">Friends' updates and reminders go to {formatPhone(me.phone)}.</p>
        {!compact && <button className="btn btn--quiet btn--small" onClick={() => setChanging(true)}>Use a different number</button>}
      </div>
    );
  }

  if (waiting) {
    const link = pending.photon_user_id ? photonVerifyLink(pending.photon_user_id, pending.code) : null;
    return (
      <div className="phone-card is-waiting">
        <p className="phone-card__title">Text us to confirm {formatPhone(pending.phone)}</p>
        {link ? (
          <>
            <a className="btn btn--primary btn--big phone-card__cta" href={link}>Text to verify</a>
            <p className="hint">Messages opens with “Verify {pending.code}” filled in. Just tap send.</p>
          </>
        ) : (
          <p className="phone-card__line">
            {dryRun || !pending.photon_user_id ? "Photon isn't connected yet. " : ""}
            Text <strong>Verify {pending.code}</strong> to the Toothbrush Connect line{pending.line_number ? ` (${formatPhone(pending.line_number)})` : ""}.
          </p>
        )}
        <p className="phone-card__status" aria-live="polite"><span className="dot" aria-hidden /> Waiting for your text…</p>
        <button className="btn btn--quiet btn--small" onClick={() => { setChanging(true); setPhone(pending.phone); }}>Use a different number</button>
      </div>
    );
  }

  return (
    <form className={`phone-card${compact ? " is-compact" : ""}`} onSubmit={start}>
      <p className="phone-card__title">Get updates in iMessage</p>
      <p className="phone-card__line">Add your number to get friends' updates and a nudge when it's time to brush.</p>
      <div className="form--inline">
        <label className="field">
          <span>Mobile number</span>
          <input type="tel" inputMode="tel" autoComplete="tel" required value={phone}
            onChange={(e) => setPhone(e.target.value)} placeholder="(555) 763-0903" />
        </label>
        <button className="btn btn--primary" disabled={busy}>{busy ? "Setting up…" : "Continue"}</button>
      </div>
      {changing && <button type="button" className="btn btn--quiet btn--small" onClick={() => setChanging(false)}>Cancel</button>}
      <ErrorNote error={error} />
    </form>
  );
}
