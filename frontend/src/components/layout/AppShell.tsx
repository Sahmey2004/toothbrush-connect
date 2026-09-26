import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { clearPendingInvite, peekPendingInvite } from "../../lib/pendingInvite";

const TABS = [
  { to: "/brush", label: "Brush", icon: "🪥" },
  { to: "/timeline", label: "Updates", icon: "💬" },
  { to: "/circle", label: "Circle", icon: "👥" },
  { to: "/lists", label: "Lists", icon: "🗂️" },
  { to: "/settings", label: "Settings", icon: "⚙️" },
];

export function AppShell() {
  const { me } = useAuth();
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
      <main className="shell__main"><Outlet /></main>
      <nav className="tabs" aria-label="Main">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} className={({ isActive }) => `tab${isActive ? " is-active" : ""}`}>
            <span className="tab__icon" aria-hidden>{t.icon}</span>
            <span className="tab__label">{t.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
