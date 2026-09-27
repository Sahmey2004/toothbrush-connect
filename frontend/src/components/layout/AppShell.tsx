import { useEffect, useState } from "react";
import { Outlet, useLocation, useOutletContext } from "react-router-dom";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { clearPendingInvite, peekPendingInvite } from "../../lib/pendingInvite";
import { NavBar, type Tab } from "./NavBar";

const TAB_FOR: Record<string, Tab> = {
  "/timeline": "feed", "/circle": "friends", "/lists": "friends", "/brush": "brush", "/journey": "journey", "/settings": "settings",
};

interface ShellContext { setImmersive: (on: boolean) => void }
export const useShell = () => useOutletContext<ShellContext>();

export function AppShell() {
  const { me } = useAuth();
  const { pathname } = useLocation();
  const [immersive, setImmersive] = useState(false); // true during an active brush session
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const token = peekPendingInvite();
    if (!token || !me?.settings.onboarded_at) return;
    clearPendingInvite();
    (async () => {
      const invite = await api.getInvite(token).catch(() => null);
      try {
        const status = await api.acceptInvite(token);
        const who = invite?.inviter_name || "your friend";
        setNotice(status === "pending" ? `Invite to ${who} sent.` : `You're connected with ${who} 🎉`);
      } catch (e) {
        setNotice(e instanceof Error ? e.message : "That invite didn't work. Ask for a new link.");
      }
    })();
  }, [me?.settings.onboarded_at]);

  return (
    <div className={`shell hand-${me?.settings.dominant_hand ?? "right"}`}>
      {notice && (
        <div className="notice" role="status">
          {notice}
          <button className="notice__close" onClick={() => setNotice(null)} aria-label="Dismiss">×</button>
        </div>
      )}
      <main className="shell__main"><Outlet context={{ setImmersive } satisfies ShellContext} /></main>
      {!immersive && <NavBar active={TAB_FOR[pathname] ?? null} />}
    </div>
  );
}
