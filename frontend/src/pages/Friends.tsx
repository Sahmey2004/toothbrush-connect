import { useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { usePresence } from "../hooks/usePresence";
import { moodInfo } from "../types/moods";
import type { CircleMember } from "../types/api";
import "../styles/pop.css";

function AddFriend({ onChange }: { onChange: () => void }) {
  const [email, setEmail] = useState("");
  const [ok, setOk] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setOk(null);
    setError(null);
    try {
      const r = await api.inviteFriend(email.trim(), "");
      setOk(
        r.status === "accepted" ? "You're connected 🎉"
          : r.status === "already_friends" ? "You're already friends."
            : "Request sent. They'll see it in their friends.",
      );
      setEmail("");
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const share = async () => {
    setError(null);
    try {
      const token = await api.createInviteLink();
      const url = `${location.origin}/invite/${token}`;
      if (navigator.share) await navigator.share({ title: "Brush with me", text: "Let's catch up while we brush", url });
      else if (navigator.clipboard) { await navigator.clipboard.writeText(url); setOk("Invite link copied."); }
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") setError(err.message);
    }
  };

  return (
    <section className="pop-add">
      <h2 className="pop-add__title">Add a friend</h2>
      <form className="pop-add__form" onSubmit={add}>
        <input
          className="pop-set__input"
          type="email"
          inputMode="email"
          autoComplete="off"
          placeholder="friend@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <button type="submit" className="pop-set__btn pop-set__btn--primary">Add</button>
      </form>
      <p className="pop-add__hint">
        Use the email they signed in with. Or <button type="button" className="pop-add__link" onClick={share}>share an invite link</button>.
      </p>
      {ok && <p className="pop-add__ok" role="status">{ok}</p>}
      {error && <p className="pop-add__err" role="alert">{error}</p>}
    </section>
  );
}

function FriendRow({ f, live }: { f: CircleMember; live: boolean }) {
  const latest = f.latest_text
    ? `“${f.latest_text}”`
    : f.latest_mood
      ? moodInfo(f.latest_mood).label
      : "No updates yet";
  return (
    <div className="pop-friend">
      <span className={"pop-friend__avatar" + (live ? " is-live" : "")}>
        {(f.display_name?.[0] ?? "?").toUpperCase()}
        {live && <span className="pop-friend__brush" aria-hidden="true">🪥</span>}
      </span>
      <div className="pop-friend__body">
        <p className="pop-friend__name">{f.display_name || "Guest friend"}</p>
        <p className={"pop-friend__latest" + (live ? " is-live" : "")}>{live ? "brushing now" : latest}</p>
      </div>
    </div>
  );
}

export default function Friends() {
  const { me } = useAuth();
  const { circle, brushingNow, loaded, refreshCircle } = usePresence(me?.id);
  const liveIds = new Set(brushingNow.map((f) => f.friend_id));

  const incoming = circle.filter((c) => c.friendship_status === "pending" && !c.requested_by_me);
  const outgoing = circle.filter((c) => c.friendship_status === "pending" && c.requested_by_me);
  const friends = circle.filter((c) => c.friendship_status === "accepted");

  const respond = async (id: string, accept: boolean) => {
    await api.respondToFriend(id, accept);
    refreshCircle();
  };

  const sub =
    friends.length === 0
      ? "Your circle"
      : brushingNow.length > 0
        ? `${friends.length} in your circle · ${brushingNow.length} brushing now`
        : `${friends.length} in your circle`;

  return (
    <>
      <header className="pop-feed__head">
        <h1 className="pop-feed__title">Friends</h1>
        <p className="pop-feed__sub">{sub}</p>
      </header>

      <AddFriend onChange={refreshCircle} />

      {incoming.length > 0 && (
        <section className="pop-day">
          <h2 className="pop-day__title">Want to join your circle</h2>
          {incoming.map((f) => (
            <div key={f.friend_id} className="pop-friend">
              <span className="pop-friend__avatar">{(f.display_name?.[0] ?? "?").toUpperCase()}</span>
              <div className="pop-friend__body">
                <p className="pop-friend__name">{f.display_name || "A friend"}</p>
              </div>
              <div className="pop-friend__act">
                <button type="button" className="pop-friend__btn pop-friend__btn--yes" onClick={() => respond(f.friend_id, true)}>Accept</button>
                <button type="button" className="pop-friend__btn pop-friend__btn--no" onClick={() => respond(f.friend_id, false)}>Decline</button>
              </div>
            </div>
          ))}
        </section>
      )}

      {loaded && friends.length === 0 && incoming.length === 0 && (
        <p className="pop-empty">No friends yet.<br />Add the people you miss by their email. 🚀</p>
      )}

      {friends.length > 0 && (
        <section className="pop-day">
          <h2 className="pop-day__title">Your circle</h2>
          <div className="pop-friends__list">
            {friends.map((f) => <FriendRow key={f.friend_id} f={f} live={liveIds.has(f.friend_id)} />)}
          </div>
        </section>
      )}

      {outgoing.length > 0 && (
        <section className="pop-day">
          <h2 className="pop-day__title">Waiting to accept</h2>
          {outgoing.map((f) => (
            <div key={f.friend_id} className="pop-friend">
              <span className="pop-friend__avatar">{(f.display_name?.[0] ?? "?").toUpperCase()}</span>
              <div className="pop-friend__body">
                <p className="pop-friend__name">{f.display_name || "Guest friend"}</p>
                <p className="pop-friend__latest">Invite sent</p>
              </div>
              <div className="pop-friend__act">
                <button type="button" className="pop-friend__btn pop-friend__btn--no" onClick={() => respond(f.friend_id, false)}>Cancel</button>
              </div>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
