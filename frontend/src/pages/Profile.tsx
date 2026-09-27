import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { usePhoneVerification } from "../hooks/usePhoneVerification";
import { clearPhoneProblem, peekPhoneProblem } from "../lib/pendingPhone";
import { formatPhone } from "../lib/phone";
import type { Channel, Settings } from "../types/api";
import "../styles/pop.css";

const CHANNELS: { id: Channel; label: string }[] = [
  { id: "imessage", label: "iMessage" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "sms", label: "Text message (SMS)" },
  { id: "web", label: "Only on this website" },
];

export default function Profile() {
  const { me, refreshMe, signOut } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState(me?.display_name ?? "");
  // A number from sign-up that couldn't be saved opens the phone field with it and the reason.
  const [phoneProblem] = useState(peekPhoneProblem);
  const { pending, link } = usePhoneVerification();
  const [phone, setPhone] = useState(phoneProblem?.phone ?? me?.phone ?? "");
  const [editingPhone, setEditingPhone] = useState(!!phoneProblem || (!me?.phone && !pending));
  const [ok, setOk] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(phoneProblem?.error ?? null);

  useEffect(() => { if (phoneProblem) clearPhoneProblem(); }, [phoneProblem]);

  if (!me) return null;
  const s = me.settings;

  const save = async (fn: () => Promise<unknown>, what: string | null) => {
    setOk(null);
    setError(null);
    try {
      await fn();
      await refreshMe();
      if (what) setOk(`${what} saved`);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  };

  const savePhone = async (e: React.FormEvent) => {
    e.preventDefault();
    // Not saved yet: the number is linked once they text us the code from it.
    if (await save(() => api.startPhoneVerification(phone), null)) setEditingPhone(false);
  };

  const removePhone = async () => {
    if (!confirm("Remove your number? You'll only see friends' updates on the website.")) return;
    if (await save(() => api.removeMyPhone(), "Phone number")) {
      setPhone("");
      setEditingPhone(true);
    }
  };

  const saveName = (e: React.FormEvent) => {
    e.preventDefault();
    save(() => api.updateDisplayName(name, me.id), "Name");
  };

  const setChannel = (channel: Channel) =>
    save(() => api.updateSettings({ preferred_channel: channel } as Partial<Settings>, me.id), "Channel");

  const doSignOut = async () => {
    await signOut();
    navigate("/", { replace: true });
  };

  const deleteAccount = async () => {
    if (!confirm("Delete your account and every update you've posted? This can't be undone.")) return;
    await api.deleteAccount();
    await signOut();
    navigate("/", { replace: true });
  };

  return (
    <>
      <header className="pop-feed__head">
        <h1 className="pop-feed__title">Profile</h1>
        <p className="pop-feed__sub">{me.email ?? me.phone ?? "Signed in"}</p>
      </header>

      <div className="pop-set">
        {ok && <p className="pop-set__ok" role="status">{ok}</p>}
        {error && <p className="pop-set__err" role="alert">{error}</p>}

        <section className="pop-set__panel">
          <h2 className="pop-set__panel-title">Your name</h2>
          <form className="pop-set__field" onSubmit={saveName}>
            <label className="pop-set__label" htmlFor="name">What friends call you</label>
            <input id="name" className="pop-set__input" value={name} maxLength={40}
              onChange={(e) => setName(e.target.value)} />
            <div className="pop-set__row">
              <button type="submit" className="pop-set__btn pop-set__btn--primary">Save name</button>
            </div>
          </form>
        </section>

        <section className="pop-set__panel">
          <h2 className="pop-set__panel-title">Your phone number</h2>
          {pending && !editingPhone ? (
            <>
              <p className="pop-set__phone">{formatPhone(pending.phone)}</p>
              <p className="pop-set__meta">
                {link ? (
                  <>
                    Text us to confirm it: Messages opens with “Verify {pending.code}” filled in. Just tap send.
                    {pending.line_number && <> On a computer, text it to {formatPhone(pending.line_number)} from your phone.</>}
                  </>
                ) : "Setting up your number. This takes a few seconds…"}
              </p>
              <div className="pop-set__row">
                {link && <a className="pop-set__btn pop-set__btn--primary" href={link}>Text to verify</a>}
                <button type="button" className="pop-set__btn pop-set__btn--ghost"
                  onClick={() => { setPhone(pending.phone); setOk(null); setError(null); setEditingPhone(true); }}>
                  Use a different number
                </button>
              </div>
              <p className="pop-set__meta" aria-live="polite">Waiting for your text…</p>
            </>
          ) : me.phone && !editingPhone ? (
            <>
              <p className="pop-set__phone">{formatPhone(me.phone)}</p>
              <div className="pop-set__row">
                <button type="button" className="pop-set__btn pop-set__btn--primary"
                  onClick={() => { setPhone(me.phone ?? ""); setOk(null); setError(null); setEditingPhone(true); }}>
                  Edit number
                </button>
                <button type="button" className="pop-set__btn pop-set__btn--ghost" onClick={removePhone}>Remove</button>
              </div>
              <p className="pop-set__meta">Friends' updates are texted here in iMessage.</p>
            </>
          ) : (
            <form className="pop-set__field" onSubmit={savePhone}>
              <label className="pop-set__label" htmlFor="phone">So the agent can text you your friends' updates</label>
              <input id="phone" className="pop-set__input" type="tel" inputMode="tel" autoComplete="tel" required
                autoFocus={!!me.phone} placeholder="(555) 010-2233" value={phone} onChange={(e) => setPhone(e.target.value)} />
              <div className="pop-set__row">
                <button type="submit" className="pop-set__btn pop-set__btn--primary">Continue</button>
                {(me.phone || pending) && (
                  <button type="button" className="pop-set__btn pop-set__btn--ghost"
                    onClick={() => { setError(null); setEditingPhone(false); }}>Cancel</button>
                )}
              </div>
              <p className="pop-set__meta">
                {me.phone
                  ? "The new number replaces the old one."
                  : "Without a number you'll only see updates on the website."}{" "}
                Next, you'll text us a code from this phone to confirm it.
              </p>
            </form>
          )}
        </section>

        <section className="pop-set__panel">
          <h2 className="pop-set__panel-title">Get friends' updates by</h2>
          <label className="pop-set__label" htmlFor="channel">Delivery channel</label>
          <select id="channel" className="pop-set__select" value={s.preferred_channel}
            onChange={(e) => setChannel(e.target.value as Channel)}>
            {CHANNELS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <p className="pop-set__meta">iMessage needs a verified phone number. Website-only always works.</p>
        </section>

        <section className="pop-set__panel">
          <h2 className="pop-set__panel-title">Account</h2>
          <div className="pop-set__row">
            <button type="button" className="pop-set__btn pop-set__btn--ghost" onClick={doSignOut}>Sign out</button>
            <button type="button" className="pop-set__btn pop-set__btn--danger" onClick={deleteAccount}>Delete account</button>
          </div>
          <p className="pop-set__meta">No streaks, no likes, no public profiles.</p>
        </section>
      </div>
    </>
  );
}
