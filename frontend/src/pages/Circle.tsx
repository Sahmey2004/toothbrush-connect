import { useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { usePresence } from "../hooks/usePresence";
import { Avatar } from "../components/common/Avatar";
import { ErrorNote } from "../components/common/ErrorNote";
import { checkInLabel, timeAgo } from "../lib/labels";
import { PhoneVerify } from "../components/phone/PhoneVerify";
import { Link } from "react-router-dom";
import { Icon, MoodIcon } from "../components/icons/Icon";
import type { CircleMember } from "../types/api";

function InviteForm({ onInvited }: { onInvited: () => void }) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setNote(null);
    try {
      const r = await api.inviteFriend(phone, name);
      setNote(
        r.status === "accepted" ? `You and ${name || "your friend"} are now connected.`
        : r.status === "already_friends" ? "You're already friends."
        : r.texted ? `Invite texted. ${name || "They"} can reply YES to join.`
        : "Invite pending. They'll see it next time they sign in.",
      );
      setPhone(""); setName("");
      onInvited();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const share = async () => {
    setError(null);
    try {
      const token = await api.createInviteLink();
      const url = `${location.origin}/invite/${token}`;
      setLink(url);
      if (navigator.share) await navigator.share({ title: "Brush with me", text: "Let's catch up while we brush our teeth", url }).catch(() => {});
      else await navigator.clipboard?.writeText(url).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section className="panel">
      <h2 className="section-title">Invite friends</h2>
      <button className="btn btn--primary btn--big" onClick={share}>Share your invite link</button>
      <p className="hint">Send it in iMessage or any chat. When they open it and sign in, you're connected.</p>
      {link && <p className="hint">Link: <code>{link}</code></p>}
      <p className="divider">or add someone who already signed up</p>
      <form className="form form--inline" onSubmit={submit}>
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sam" maxLength={40} />
        </label>
        <label className="field">
          <span>Email or phone</span>
          <input type="text" inputMode="email" autoComplete="off" required value={phone}
            onChange={(e) => setPhone(e.target.value)} placeholder="sam@gmail.com" />
        </label>
        <button className="btn btn--primary">Send invite</button>
      </form>
      <p className="hint">Use the email they sign in with, and they'll see your request in their circle.</p>
      {note && <p className="ok-note" role="status">{note}</p>}
      <ErrorNote error={error} />
    </section>
  );
}

function FriendRow({ f, onChange }: { f: CircleMember; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const act = (fn: () => Promise<void>) => async () => { await fn(); onChange(); };
  return (
    <li className="friend">
      <Avatar id={f.friend_id} name={f.display_name} live={f.brushing_now} />
      <div className="friend__body">
        <p className="friend__name">
          {f.display_name || "Guest friend"}
          {f.is_guest && <span className="friend__tag"> by text</span>}
        </p>
        {f.latest_mood ? (
          <p className="friend__latest">
            <span className={`friend__mood mood-tone--${f.latest_mood}`}><MoodIcon mood={f.latest_mood} size={18} />{checkInLabel(f.latest_mood, f.latest_scope!, f.latest_audience_label!)}</span>{" "}
            {f.latest_text && `“${f.latest_text}” `}<span className="muted">{timeAgo(f.latest_at!)}</span>
          </p>
        ) : (
          <p className="friend__latest muted">{f.brushing_now ? "Brushing now" : "No updates yet"}</p>
        )}
      </div>
      <button className="btn btn--quiet btn--small" onClick={() => setOpen(!open)} aria-expanded={open}>Manage</button>
      {open && (
        <div className="friend__menu">
          <button className="btn btn--quiet btn--small" onClick={act(() => api.removeFriend(f.friend_id))}>Remove</button>
          <button className="btn btn--danger btn--small" onClick={act(() => api.blockFriend(f.friend_id))}>Block</button>
        </div>
      )}
    </li>
  );
}

export default function Circle() {
  const { me } = useAuth();
  const { circle, loaded, refreshCircle } = usePresence(me?.id);
  // Shown while the number isn't linked yet, and kept for this visit so the success message stays.
  const [showPhoneCard] = useState(() => !me?.phone);
  const incoming = circle.filter((c) => c.friendship_status === "pending" && !c.requested_by_me);
  const outgoing = circle.filter((c) => c.friendship_status === "pending" && c.requested_by_me);
  const friends = circle.filter((c) => c.friendship_status === "accepted");

  return (
    <div className="page">
      <header className="page-head page-head--row">
        <h1 className="page-title">Friends</h1>
        <Link className="btn btn--quiet btn--small" to="/lists"><Icon name="lists" size={18} /> Lists</Link>
      </header>
      {showPhoneCard && <PhoneVerify compact />}

      {incoming.length > 0 && (
        <section className="panel">
          <h2 className="section-title">Want to join your circle</h2>
          <ul className="friends">
            {incoming.map((f) => (
              <li key={f.friend_id} className="friend">
                <Avatar id={f.friend_id} name={f.display_name} />
                <p className="friend__name friend__body">{f.display_name || "A friend"}</p>
                <button className="btn btn--primary btn--small" onClick={async () => { await api.respondToFriend(f.friend_id, true); refreshCircle(); }}>Accept</button>
                <button className="btn btn--quiet btn--small" onClick={async () => { await api.respondToFriend(f.friend_id, false); refreshCircle(); }}>Decline</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        {loaded && friends.length === 0 && <p className="empty">Nobody here yet. Invite the 3 to 8 people you miss most.</p>}
        <ul className="friends">
          {friends.map((f) => <FriendRow key={f.friend_id} f={f} onChange={refreshCircle} />)}
        </ul>
        <p className="hint">{friends.length} of 25 friends</p>
      </section>

      {outgoing.length > 0 && (
        <section>
          <h2 className="section-title">Waiting for a YES</h2>
          <ul className="friends">
            {outgoing.map((f) => (
              <li key={f.friend_id} className="friend friend--pending">
                <Avatar id={f.friend_id} name={f.display_name} />
                <p className="friend__name friend__body">{f.display_name || "Guest friend"}</p>
                <button className="btn btn--quiet btn--small" onClick={async () => { await api.respondToFriend(f.friend_id, false); refreshCircle(); }}>Cancel</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <InviteForm onInvited={refreshCircle} />
    </div>
  );
}
