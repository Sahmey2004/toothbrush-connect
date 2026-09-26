import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { ErrorNote } from "../components/common/ErrorNote";
import type { Channel, FriendList, Settings as S } from "../types/api";

const CHANNELS: { id: Channel; label: string }[] = [
  { id: "imessage", label: "iMessage" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "sms", label: "SMS" },
  { id: "web", label: "Only on this website" },
];

const hhmm = (t: string) => t.slice(0, 5);

export default function Settings() {
  const { me, refreshMe, signOut } = useAuth();
  const navigate = useNavigate();
  const [lists, setLists] = useState<FriendList[]>([]);
  const [name, setName] = useState(me?.display_name ?? "");
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.lists().then(setLists).catch(() => {}); }, []);
  if (!me) return null;
  const s = me.settings;

  const save = async (patch: Partial<S>, what: string) => {
    setError(null); setSaved(null);
    try {
      await api.updateSettings(patch, me.id);
      await refreshMe();
      setSaved(`${what} saved`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const presenceValue = s.invisible ? "nobody" : s.presence_list_id ?? "default";

  const exportData = async () => {
    const data = await api.exportData();
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "toothbrush-connect-export.json" });
    a.click();
    URL.revokeObjectURL(url);
  };

  const deleteAccount = async () => {
    if (!confirm("Delete your account and every update you've posted? This can't be undone.")) return;
    await api.deleteAccount();
    await signOut();
    navigate("/", { replace: true });
  };

  return (
    <div className="page">
      <h1 className="page-title">Settings</h1>
      {saved && <p className="ok-note" role="status">{saved}</p>}
      <ErrorNote error={error} />

      <section className="panel form">
        <h2 className="section-title">You</h2>
        <form className="form form--inline" onSubmit={async (e) => {
          e.preventDefault();
          try { await api.updateDisplayName(name, me.id); await refreshMe(); setSaved("Name saved"); }
          catch (err) { setError(err instanceof Error ? err.message : String(err)); }
        }}>
          <label className="field"><span>Name</span><input required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} /></label>
          <button className="btn btn--quiet">Save name</button>
        </form>
        <p className="hint">Signed in as {me.email ?? me.phone}</p>
      </section>

      <section className="panel form">
        <h2 className="section-title">Who sees what</h2>
        <label className="field">
          <span>Default audience for updates</span>
          <select value={s.default_list_id ?? ""} onChange={(e) => save({ default_list_id: e.target.value || null }, "Default audience")}>
            <option value="">Everyone</option>
            {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Who's told when you're brushing</span>
          <select value={presenceValue} onChange={(e) => {
            const v = e.target.value;
            save(v === "nobody" ? { invisible: true } : { invisible: false, presence_list_id: v === "default" ? null : v }, "Brushing visibility");
          }}>
            <option value="default">Same as default audience</option>
            {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            <option value="nobody">Nobody (invisible)</option>
          </select>
        </label>
      </section>

      <section className="panel form">
        <h2 className="section-title">Messages</h2>
        <label className="field">
          <span>Get friends' updates by</span>
          <select value={s.preferred_channel} onChange={(e) => save({ preferred_channel: e.target.value as Channel }, "Channel")}>
            {CHANNELS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        <div className="form--inline">
          <label className="field">
            <span>Quiet from</span>
            <input type="time" value={hhmm(s.quiet_start)} onChange={(e) => save({ quiet_start: e.target.value }, "Quiet hours")} />
          </label>
          <label className="field">
            <span>Until</span>
            <input type="time" value={hhmm(s.quiet_end)} onChange={(e) => save({ quiet_end: e.target.value }, "Quiet hours")} />
          </label>
        </div>
        <p className="hint">No texts during quiet hours ({s.timezone}). Updates wait until morning.</p>
      </section>

      <section className="panel form">
        <h2 className="section-title">Layout</h2>
        <div className="segmented" role="radiogroup" aria-label="Brushing hand">
          {(["right", "left"] as const).map((h) => (
            <button key={h} role="radio" aria-checked={s.dominant_hand === h} className={s.dominant_hand === h ? "is-on" : ""}
              onClick={() => save({ dominant_hand: h }, "Layout")}>
              I brush with my {h}
            </button>
          ))}
        </div>
        <p className="hint">Controls move to the side of your free thumb.</p>
      </section>

      <section className="panel form">
        <h2 className="section-title">Your data</h2>
        <div className="row">
          <button className="btn btn--quiet" onClick={exportData}>Download my data</button>
          <button className="btn btn--quiet" onClick={async () => { await signOut(); navigate("/", { replace: true }); }}>Sign out</button>
          <button className="btn btn--danger" onClick={deleteAccount}>Delete account</button>
        </div>
      </section>
    </div>
  );
}
