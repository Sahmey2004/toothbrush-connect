import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import { clearPendingInvite, savePendingInvite } from "../lib/pendingInvite";
import Landing from "./Landing";

// /invite/:token — a friend's invite link: the landing page with their name. The token is saved so AccountGate can
// accept it once the person has signed in (and is set up), whichever way they come back.
export default function Invite() {
  const { token = "" } = useParams();
  const [inviter, setInviter] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    api.getInvite(token).then((i) => {
      if (i) savePendingInvite(token);
      else clearPendingInvite();
      setInviter(i ? i.inviter_name ?? "" : null);
    }).catch(() => setInviter(null));
  }, [token]);

  if (inviter === undefined) return <div className="pop" aria-busy="true" />;
  if (inviter === null) return <Landing notice="This invite link has expired. Ask your friend for a new one." />;
  return <Landing invite={{ inviterName: inviter || null, returnTo: `/invite/${token}` }} />;
}
