import { useState } from "react";
import { supabase } from "../../lib/supabase";
import { ErrorNote } from "../common/ErrorNote";

const toE164 = (raw: string) => {
  const digits = raw.replace(/\D/g, "");
  if (raw.trim().startsWith("+")) return `+${digits}`;
  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
};

// FR-A1 phone sign-in with a one-time code. Off by default until an SMS sender (Photon) is set up;
// enable with VITE_ENABLE_PHONE_AUTH=true.
export function PhoneSignIn() {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    const p = toE164(phone);
    const { error } = await supabase.auth.signInWithOtp({ phone: p });
    setBusy(false);
    if (error) setError(error.message);
    else setSentTo(p);
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sentTo) return;
    setBusy(true); setError(null);
    const { error } = await supabase.auth.verifyOtp({ phone: sentTo, token: code.trim(), type: "sms" });
    setBusy(false);
    if (error) setError(error.message === "Token has expired or is invalid" ? "That code didn't work. Check it or send a new one." : error.message);
  };

  return (
    <>
      {!sentTo ? (
        <form className="form" onSubmit={send}>
          <label className="field">
            <span>Phone number</span>
            <input type="tel" inputMode="tel" autoComplete="tel" required value={phone}
              onChange={(e) => setPhone(e.target.value)} placeholder="(555) 000-0001" />
          </label>
          <button className="btn btn--quiet btn--big" disabled={busy}>{busy ? "Sending…" : "Text me a code"}</button>
        </form>
      ) : (
        <form className="form" onSubmit={verify}>
          <label className="field">
            <span>Code sent to {sentTo}</span>
            <input inputMode="numeric" autoComplete="one-time-code" required maxLength={6} value={code}
              onChange={(e) => setCode(e.target.value)} placeholder="123456" />
          </label>
          <button className="btn btn--primary btn--big" disabled={busy}>{busy ? "Checking…" : "Sign in"}</button>
          <button type="button" className="btn btn--quiet" onClick={() => { setSentTo(null); setCode(""); }}>Use a different number</button>
        </form>
      )}
      <ErrorNote error={error} />
    </>
  );
}
