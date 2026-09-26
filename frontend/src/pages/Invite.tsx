import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { ErrorNote } from "../components/common/ErrorNote";

// /invite/:token — a friend's shareable invite link.
export default function Invite() {
  const { token = "" } = useParams();
  const { session, me } = useAuth();
  const navigate = useNavigate();
  const [inviter, setInviter] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getInvite(token).then((i) => setInviter(i?.inviter_name ?? null)).catch(() => setInviter(null));
  }, [token]);

  const accept = async () => {
    try {
      await api.acceptInvite(token);
      navigate("/circle", { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (inviter === undefined) return null;
  if (inviter === null) {
    return (
      <div className="narrow">
        <h1 className="page-title">This invite has expired</h1>
        <p>Ask your friend to send a new link.</p>
      </div>
    );
  }
  const next = `/invite/${token}`;
  return (
    <div className="narrow">
      <h1 className="page-title">{inviter || "A friend"} wants to catch up while brushing</h1>
      <p>You'll see each other's quick updates during the two minutes you brush. Nothing is shared until you both say yes.</p>
      {session && me?.settings.onboarded_at ? (
        <button className="btn btn--primary btn--big" onClick={accept}>Join {inviter || "their"} circle</button>
      ) : session ? (
        <Link className="btn btn--primary btn--big" to={`/onboarding?next=${encodeURIComponent(next)}`}>Set up and join</Link>
      ) : (
        <Link className="btn btn--primary btn--big" to={`/login?next=${encodeURIComponent(next)}`}>Sign in to join</Link>
      )}
      <ErrorNote error={error} />
    </div>
  );
}
