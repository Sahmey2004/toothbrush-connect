import { Link } from "react-router-dom";
import { Icon, type IconName } from "../icons/Icon";

export type Tab = "feed" | "friends" | "brush" | "journey" | "settings";

const TABS: { id: Tab; to: string; label: string; icon: IconName }[] = [
  { id: "feed", to: "/timeline", label: "Feed", icon: "feed" },
  { id: "friends", to: "/circle", label: "Friends", icon: "friends" },
  { id: "brush", to: "/brush", label: "Brush", icon: "crescent" },
  { id: "journey", to: "/journey", label: "Journey", icon: "capsule" },
  { id: "settings", to: "/settings", label: "Settings", icon: "settings" },
];

// Frosted midnight glass, labels always visible, a small gold "moon" dot under the active tab.
// The raised centre Brush button shows a tiny crescent. Hidden during an active session.
export function NavBar({ active }: { active: Tab | null }) {
  return (
    <nav className="navbar" aria-label="Main">
      {TABS.map((t) => (
        <Link key={t.id} to={t.to} className={`navbar__tab${t.id === "brush" ? " navbar__tab--brush" : ""}${active === t.id ? " is-active" : ""}`}
          aria-current={active === t.id ? "page" : undefined}>
          <span className="navbar__icon"><Icon name={t.icon} size={t.id === "brush" ? 26 : 24} /></span>
          <span className="navbar__label">{t.label}</span>
          {t.id !== "brush" && <span className="navbar__dot" aria-hidden="true" />}
        </Link>
      ))}
    </nav>
  );
}
