import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";

const TABS = [
  { to: "/brush", label: "Brush", icon: "🪥" },
  { to: "/timeline", label: "Updates", icon: "💬" },
  { to: "/circle", label: "Circle", icon: "👥" },
  { to: "/lists", label: "Lists", icon: "🗂️" },
  { to: "/settings", label: "Settings", icon: "⚙️" },
];

export function AppShell() {
  const { me } = useAuth();
  return (
    <div className={`shell hand-${me?.settings.dominant_hand ?? "right"}`}>
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
