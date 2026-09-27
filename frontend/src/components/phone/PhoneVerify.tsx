import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { usePhoneVerification } from "../../hooks/usePhoneVerification";
import { formatPhone } from "../../lib/phone";
import { ErrorNote } from "../common/ErrorNote";

// Add the number friends' updates are texted to, by texting a code from it to the user's Photon line: the text
// proves the number, and Photon can message it from then on (shared lines only message numbers that texted first).
export function PhoneVerify({ compact = false }: { compact?: boolean }) {
  const { me, refreshMe } = useAuth();
  const { pending, link } = usePhoneVerification();
  const [phone, setPhone] = useState("");
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justVerified, setJustVerified] = useState(false);
  const waiting = !!pending && !changing;

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
      await api.startPhoneVerification(phone);
      await refreshMe();
      setChanging(false);
      setPhone("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (pending && !changing) {
    return (
      <div className={`phone-card is-waiting${compact ? " is-compact" : ""}`}>
        <p className="phone-card__title">Text us to confirm {formatPhone(pending.phone)}</p>
        {link ? (
          <>
            <a className="btn btn--primary btn--big phone-card__cta" href={link}>Text to verify</a>
            <p className="phone-card__line">
              Messages opens with “Verify {pending.code}” filled in. Just tap send.
              {pending.line_number && <> On a computer, text it to {formatPhone(pending.line_number)} from your phone.</>}
            </p>
          </>
        ) : (
          <p className="phone-card__line">Setting up your number. This takes a few seconds…</p>
        )}
        <p className="phone-card__status" aria-live="polite"><span className="dot" aria-hidden /> Waiting for your text…</p>
        <button className="btn btn--quiet btn--small" onClick={() => { setChanging(true); setPhone(pending.phone); }}>Use a different number</button>
      </div>
    );
  }

  if (me.phone && !changing) {
    return (
      <div className={`phone-card is-done${compact ? " is-compact" : ""}`}>
        <p className="phone-card__title">{justVerified ? "✅ You're connected!" : "✅ iMessage connected"}</p>
        <p className="phone-card__line">Friends' updates and reminders go to {formatPhone(me.phone)}.</p>
        {!compact && <button className="btn btn--quiet btn--small" onClick={() => setChanging(true)}>Use a different number</button>}
      </div>
    );
  }

  return (
    <form className={`phone-card${compact ? " is-compact" : ""}`} onSubmit={start}>
      <p className="phone-card__title">Get updates in iMessage</p>
      <p className="phone-card__line">Add your number to get friends' updates and a nudge when it's time to brush. You'll confirm it by texting us a code.</p>
      <div className="form--inline">
        <label className="field">
          <span>Mobile number</span>
          <input type="tel" inputMode="tel" autoComplete="tel" required value={phone}
            onChange={(e) => setPhone(e.target.value)} placeholder="(555) 763-0903" />
        </label>
        <button className="btn btn--primary" disabled={busy}>{busy ? "Setting up…" : "Continue"}</button>
      </div>
      {changing && <button type="button" className="btn btn--quiet btn--small" onClick={() => { setChanging(false); setPhone(""); }}>Cancel</button>}
      <ErrorNote error={error} />
    </form>
  );
}
