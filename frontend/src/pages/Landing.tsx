import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";

// PRD Flow D: what lands in a friend's iMessage after you post on the site.
const SCRIPT: { label: string; text: string; link: string }[] = [
  { label: "🪥 BRUSHING NOW", text: "Sam is brushing.", link: "Join → tbc.link/b/7Qm1" },
  { label: "😄 FUN · this week", text: 'Aisha: "got the job!!"', link: "React or share yours → tbc.link/r/a8K2" },
  { label: "💌 JUST FOR YOU · STRESSFUL", text: 'Priya: "moving apartments, send help"', link: "React or share yours → tbc.link/r/f3Lx" },
  { label: "👥 CLOSE CIRCLE · BORING", text: "Marcus", link: "React or share yours → tbc.link/r/q9Zt" },
];

function Conversation() {
  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [shown, setShown] = useState(reduced ? SCRIPT.length : 1);
  useEffect(() => {
    if (reduced) return;
    const t = setInterval(() => setShown((n) => (n >= SCRIPT.length + 2 ? 1 : n + 1)), 1600);
    return () => clearInterval(t);
  }, [reduced]);
  return (
    <div className="phone" aria-label="Example updates arriving in iMessage">
      <div className="phone__header">Toothbrush Connect</div>
      <ol className="thread">
        {SCRIPT.slice(0, Math.min(shown, SCRIPT.length)).map((m, i) => (
          <li key={i} className="bubble bubble--agent">
            <strong className="bubble__label">[{m.label}]</strong> {m.text}
            <span className="bubble__link">{m.link}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function Landing() {
  const { session, me } = useAuth();
  // Returning from Google sign-in can land here; send signed-in people into the app.
  if (session && me) return <Navigate to={me.settings.onboarded_at ? "/brush" : "/onboarding"} replace />;
  const cta = "/login";
  return (
    <div className="landing">
      <header className="landing__bar">
        <span className="wordmark">Toothbrush Connect</span>
        <Link className="btn btn--quiet" to={cta}>Sign in</Link>
      </header>

      <section className="hero">
        <div className="hero__copy">
          <h1 className="hero__title">Two minutes, twice a day, with the friends back home.</h1>
          <p className="hero__lede">
            Start the timer, tap how your day went, and see what your circle is up to.
            Friends get your update in iMessage and on the site. Nothing to install.
          </p>
          <div className="hero__actions">
            <Link className="btn btn--primary btn--big" to={cta}>Start brushing</Link>
            <span className="hero__note">Sign in with Google</span>
          </div>
        </div>
        <Conversation />
      </section>

      <section className="points">
        <div className="point">
          <h2>One tap is a whole update</h2>
          <p>Fun, stressful, boring or just okay. Add a line if you want. Your other hand is holding a toothbrush.</p>
        </div>
        <div className="point">
          <h2>You choose who sees it</h2>
          <p>Everyone, a saved list like "Close 3", or one person. You have 30 seconds to change your mind before anything is sent.</p>
        </div>
        <div className="point">
          <h2>It lands in their iMessage</h2>
          <p>Friends see your update on the site and as a text (WhatsApp or SMS if they don't have iMessage). The link brings them back to share theirs.</p>
        </div>
      </section>

      <footer className="landing__foot">
        No streaks, no likes, no public profiles. Text STOP any time.
      </footer>
    </div>
  );
}
