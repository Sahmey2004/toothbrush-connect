import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { clearInviteNotice, peekInviteNotice } from "../../lib/pendingInvite";
import { MiniTimer } from "../timer/MiniTimer";
import "../../styles/pop.css";

/* The signed-in shell in the pop identity: a scrolling page over a fixed bottom nav.
   Three tabs (Brush · Feed · Friends) from the shared nav mockup. The Brush tab leads to
   the full-screen /start timer, which lives outside this shell — so the bar shows on the
   feed and friends, and disappears during the timer. */

type Tab = "brush" | "feed" | "friends";

function TabIcon({ tab }: { tab: Tab }) {
  if (tab === "brush") {
    return (
      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
        <g transform="rotate(-35 13 13)" fill="currentColor">
          <rect x="3" y="12" width="20" height="5" rx="2.5" />
          <rect x="4" y="6" width="2.4" height="6" rx="1.2" />
          <rect x="7.5" y="6" width="2.4" height="6" rx="1.2" />
          <rect x="11" y="6" width="2.4" height="6" rx="1.2" />
        </g>
      </svg>
    );
  }
  if (tab === "feed") {
    return (
      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
        <rect x="4" y="4" width="18" height="8" rx="3" fill="none" stroke="currentColor" strokeWidth="2.2" />
        <rect x="4" y="15" width="18" height="8" rx="3" fill="none" stroke="currentColor" strokeWidth="2.2" />
      </svg>
    );
  }
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
      <circle cx="9" cy="13" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <circle cx="18" cy="13" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.2" />
    </svg>
  );
}

const tabClass = ({ isActive }: { isActive: boolean }) => "pop-tab" + (isActive ? " is-active" : "");
const meClass = ({ isActive }: { isActive: boolean }) => "pop-appbar__me" + (isActive ? " is-active" : "");

export function PopShell() {
  const { me } = useAuth();
  const { pathname } = useLocation();
  // Profile has the "Text to verify" button, and keeps checking for the text.
  const verifyNudge = !!me?.phone_verification && pathname !== "/profile";
  // "You're connected with Priya 🎉" after AccountGate accepted an invite link; shown once.
  const [inviteNotice, setInviteNotice] = useState(peekInviteNotice);
  useEffect(() => clearInviteNotice(), []);
  const initial = (me?.display_name?.trim()?.[0] ?? "🙂").toUpperCase();

  // Keep the whole document dark (incl. overscroll) while the signed-in app is mounted.
  useEffect(() => {
    document.body.classList.add("pop-body");
    return () => document.body.classList.remove("pop-body");
  }, []);

  return (
    <div className="pop pop-app">
      <div className="pop-top">
        <header className="pop-appbar">
          <NavLink to="/feed" className="pop-appbar__brand">
            <svg width="28" height="28" viewBox="0 0 36 36" aria-hidden="true">
              <circle cx="18" cy="18" r="16" fill="#FFE27A" />
              <circle cx="25" cy="10" r="3.5" fill="#F2C94C" />
              <circle cx="12" cy="18" r="2.6" fill="#17171C" />
              <circle cx="21" cy="18" r="2.6" fill="#17171C" />
            </svg>
            moonbrush connect
          </NavLink>
          <NavLink to="/profile" className={meClass} aria-label="Profile and settings">
            {initial}
          </NavLink>
        </header>
        <MiniTimer />
        {inviteNotice && (
          <p className="pop-verify" role="status">
            {inviteNotice}{" "}
            <button type="button" className="pop-verify__close" onClick={() => setInviteNotice(null)} aria-label="Dismiss">×</button>
          </p>
        )}
        {verifyNudge && (
          <NavLink to="/profile" className="pop-verify">
            One more step: text us a code to turn on iMessage updates →
          </NavLink>
        )}
      </div>
      <main className="pop-app__main">
        <Outlet />
      </main>
      <nav className="pop-tabs" aria-label="Main">
        <div className="pop-tabs__bar">
          <NavLink to="/start" className={tabClass}>
            <TabIcon tab="brush" />
            <span>Brush</span>
          </NavLink>
          <NavLink to="/feed" className={tabClass}>
            <TabIcon tab="feed" />
            <span>Feed</span>
          </NavLink>
          <NavLink to="/friends" className={tabClass}>
            <TabIcon tab="friends" />
            <span>Friends</span>
          </NavLink>
        </div>
      </nav>
    </div>
  );
}
