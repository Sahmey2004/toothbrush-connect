import { useState } from "react";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { formatPhone } from "../../lib/phone";
import { ErrorNote } from "../common/ErrorNote";

// Add the number friends' updates are texted to. Self-declared (no code): set_my_phone saves it,
// and within a few seconds the agent registers it with Photon and sends a welcome text.
export function PhoneVerify({ compact = false }: { compact?: boolean }) {
  const { me, refreshMe } = useAuth();
  const [phone, setPhone] = useState("");
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!me) return null;

  const save = async (value: string, e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.setMyPhone(value);
      await refreshMe();
      setChanging(false);
      setPhone("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (me.phone && !changing) {
    return (
      <div className={`phone-card is-done${compact ? " is-compact" : ""}`}>
        <p className="phone-card__title">✅ iMessage connected</p>
        <p className="phone-card__line">Friends' updates and reminders go to {formatPhone(me.phone)}.</p>
        {!compact && <button className="btn btn--quiet btn--small" onClick={() => setChanging(true)}>Use a different number</button>}
      </div>
    );
  }

  return (
    <form className={`phone-card${compact ? " is-compact" : ""}`} onSubmit={(e) => save(phone, e)}>
      <p className="phone-card__title">Get updates in iMessage</p>
      <p className="phone-card__line">Add your number to get friends' updates and a nudge when it's time to brush.</p>
      <div className="form--inline">
        <label className="field">
          <span>Mobile number</span>
          <input type="tel" inputMode="tel" autoComplete="tel" required value={phone}
            onChange={(e) => setPhone(e.target.value)} placeholder="(555) 763-0903" />
        </label>
        <button className="btn btn--primary" disabled={busy}>{busy ? "Saving…" : "Save number"}</button>
      </div>
      {changing && <button type="button" className="btn btn--quiet btn--small" onClick={() => { setChanging(false); setPhone(""); }}>Cancel</button>}
      <ErrorNote error={error} />
    </form>
  );
}
