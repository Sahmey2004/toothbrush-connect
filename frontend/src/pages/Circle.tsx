import { useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { usePresence } from "../hooks/usePresence";
import { Avatar } from "../components/common/Avatar";
import { ErrorNote } from "../components/common/ErrorNote";
import { checkInLabel, timeAgo } from "../lib/labels";
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
    const token = await api.createInviteLink();
    const url = `${location.origin}/invite/${token}`;
    setLink(url);
    if (navigator.share) navigator.share({ title: "Brush with me", url }).catch(() => {});
    else navigator.clipboard?.writeText(url).catch(() => {});
  };

  return (
    <section className="panel">
      <h2 className="section-title">Invite a friend</h2>
      <form className="form form--inline" onSubmit={submit}>
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sam" maxLength={40} />
        </label>
        <label className="field">
          <span>Phone</span>
          <input type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 000-0002" />
        </label>
        <button className="btn btn--primary">Send invite</button>
      </form>
      <p className="hint">They get one text: “Reply YES to join.” No follow-ups if they don't.</p>
      <button className="btn btn--quiet" onClick={share}>Share an invite link instead</button>
      {link && <p className="hint">Copied: <code>{link}</code></p>}
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
            <span className="label">[{checkInLabel(f.latest_mood, f.latest_scope!, f.latest_audience_label!)}]</span>{" "}
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
  const incoming = circle.filter((c) => c.friendship_status === "pending" && !c.requested_by_me);
  const outgoing = circle.filter((c) => c.friendship_status === "pending" && c.requested_by_me);
  const friends = circle.filter((c) => c.friendship_status === "accepted");

  return (
    <div className="page">
      <h1 className="page-title">Your circle</h1>

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
