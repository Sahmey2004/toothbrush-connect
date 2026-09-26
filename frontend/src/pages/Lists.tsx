import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { ErrorNote } from "../components/common/ErrorNote";
import type { CircleMember, FriendList } from "../types/api";

function ListEditor({ list, friends, isDefault, onSaved, onCancel }: {
  list: FriendList | null; friends: CircleMember[]; isDefault: boolean; onSaved: () => void; onCancel: () => void;
}) {
  const { me, refreshMe } = useAuth();
  const [name, setName] = useState(list?.name ?? "");
  const [members, setMembers] = useState<string[]>(list?.members ?? []);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      if (list) {
        if (name.trim() !== list.name) await api.renameList(list.id, name);
        await api.setListMembers(list.id, list.members, members);
      } else {
        await api.createList(name, members);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const remove = async () => {
    if (!list || !confirm(`Delete “${list.name}”? Friends in it stay in your circle.`)) return;
    await api.deleteList(list.id);
    if (isDefault) await refreshMe();
    onSaved();
  };

  const makeDefault = async () => {
    if (!list || !me) return;
    await api.updateSettings({ default_list_id: list.id }, me.id);
    await refreshMe();
  };

  return (
    <form className="panel form" onSubmit={save}>
      <label className="field">
        <span>List name</span>
        <input required maxLength={30} value={name} onChange={(e) => setName(e.target.value)} placeholder="Close 3" autoFocus />
      </label>
      <fieldset className="field">
        <legend>Who's in it</legend>
        {friends.length === 0 && <p className="hint">Add friends to your circle first.</p>}
        <div className="toggles">
          {friends.map((f) => (
            <label key={f.friend_id} className={`toggle${members.includes(f.friend_id) ? " is-on" : ""}`}>
              <input type="checkbox" checked={members.includes(f.friend_id)}
                onChange={(e) => setMembers(e.target.checked ? [...members, f.friend_id] : members.filter((m) => m !== f.friend_id))} />
              {f.display_name || "Guest friend"}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="row">
        <button className="btn btn--primary">{list ? "Save list" : "Create list"}</button>
        <button type="button" className="btn btn--quiet" onClick={onCancel}>Cancel</button>
        {list && !isDefault && <button type="button" className="btn btn--quiet" onClick={makeDefault}>Make default</button>}
        {list && <button type="button" className="btn btn--danger" onClick={remove}>Delete</button>}
      </div>
      <ErrorNote error={error} />
    </form>
  );
}

// FR-R6: saved lists, private to their owner, up to 10.
export default function Lists() {
  const { me } = useAuth();
  const [lists, setLists] = useState<FriendList[]>([]);
  const [friends, setFriends] = useState<CircleMember[]>([]);
  const [editing, setEditing] = useState<string | "new" | null>(null);

  const load = async () => {
    const [l, c] = await Promise.all([api.lists(), api.circle()]);
    setLists(l);
    setFriends(c.filter((f) => f.friendship_status === "accepted"));
  };
  useEffect(() => { load(); }, []);

  const nameOf = (id: string) => friends.find((f) => f.friend_id === id)?.display_name || "Guest friend";
  const defaultId = me?.settings.default_list_id;

  return (
    <div className="page">
      <h1 className="page-title">Lists</h1>
      <p className="hint">Only you can see your lists. Pick one when you post, or make it your default.</p>
      <ul className="lists">
        <li className="list-row">
          <span className="pick__key">*</span>
          <div className="list-row__body">
            <p className="list-row__name">Everyone {!defaultId && <span className="badge">Default</span>}</p>
            <p className="muted">All {friends.length} friends in your circle</p>
          </div>
        </li>
        {lists.map((l) => editing === l.id ? (
          <li key={l.id}>
            <ListEditor list={l} friends={friends} isDefault={defaultId === l.id}
              onSaved={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} />
          </li>
        ) : (
          <li key={l.id} className="list-row">
            <span className="pick__key">{l.letter}</span>
            <div className="list-row__body">
              <p className="list-row__name">{l.name} {defaultId === l.id && <span className="badge">Default</span>}</p>
              <p className="muted">{l.members.length ? l.members.map(nameOf).join(", ") : "Nobody yet"}</p>
            </div>
            <button className="btn btn--quiet btn--small" onClick={() => setEditing(l.id)}>Edit</button>
          </li>
        ))}
      </ul>
      {editing === "new" ? (
        <ListEditor list={null} friends={friends} isDefault={false}
          onSaved={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} />
      ) : (
        lists.length < 10 && <button className="btn btn--primary" onClick={() => setEditing("new")}>New list</button>
      )}
    </div>
  );
}
