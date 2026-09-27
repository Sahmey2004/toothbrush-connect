import { useEffect, useRef, useState } from "react";
import { Outlet } from "react-router-dom";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { clearPendingInvite, peekPendingInvite, saveInviteNotice } from "../../lib/pendingInvite";
import { clearPendingSignup, peekPendingSignup, setupFor } from "../../lib/signupSetup";

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Between sign-in and the app. Finishes setting up a new account on its own (there is no onboarding page), then
// accepts an invite link saved before Google sign-in, so the friend is already in the list when the app opens.
export function AccountGate() {
  const { me, refreshMe } = useAuth();
  const onboarded = !!me?.settings.onboarded_at;
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [inviteDone, setInviteDone] = useState(() => !peekPendingInvite());
  const settingUp = useRef(false);
  const accepting = useRef(false);

  useEffect(() => {
    if (!me || onboarded || settingUp.current) return;
    settingUp.current = true;
    const s = setupFor(me, peekPendingSignup(), Intl.DateTimeFormat().resolvedOptions().timeZone);
    (async () => {
      await api.completeOnboarding(s.name, s.timezone, s.brushTimes);
      if (s.channel) await api.updateSettings({ preferred_channel: s.channel }, me.id);
      clearPendingSignup();
      await refreshMe();
    })()
      .catch((e) => setError(errorText(e)))
      .finally(() => { settingUp.current = false; });
  }, [me, onboarded, attempt, refreshMe]);

  useEffect(() => {
    if (!onboarded || inviteDone || accepting.current) return;
    const token = peekPendingInvite();
    if (!token) return setInviteDone(true);
    accepting.current = true;
    clearPendingInvite();
    (async () => {
      const invite = await api.getInvite(token).catch(() => null);
      const who = invite?.inviter_name || "your friend";
      try {
        const status = await api.acceptInvite(token);
        saveInviteNotice(status === "pending" ? `Invite to ${who} sent.` : `You're connected with ${who} 🎉`);
      } catch (e) {
        saveInviteNotice(e instanceof Error ? e.message : "That invite didn't work. Ask for a new link.");
      }
    })().finally(() => setInviteDone(true));
  }, [onboarded, inviteDone]);

  if (error) {
    return (
      <div className="pop pop-gate">
        <p className="pop-error" role="alert">Couldn't finish setting up your account: {error}</p>
        <button type="button" className="pop-login" onClick={() => { setError(null); setAttempt((a) => a + 1); }}>
          Try again
        </button>
      </div>
    );
  }
  if (!onboarded || !inviteDone) return <div className="pop" aria-busy="true" />;
  return <Outlet />;
}
