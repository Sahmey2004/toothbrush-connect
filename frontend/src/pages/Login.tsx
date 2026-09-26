import { useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthProvider";
import { ErrorNote } from "../components/common/ErrorNote";
import { PhoneSignIn } from "../components/auth/PhoneSignIn";

const phoneEnabled = import.meta.env.VITE_ENABLE_PHONE_AUTH === "true";

function GoogleMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export default function Login() {
  const { session, me } = useAuth();
  const [params] = useSearchParams();
  const next = params.get("next");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (session && me) {
    if (me.settings.onboarded_at) return <Navigate to={next ?? "/brush"} replace />;
    return <Navigate to={next ? `/onboarding?next=${encodeURIComponent(next)}` : "/onboarding"} replace />;
  }

  const google = async () => {
    setBusy(true); setError(null);
    const redirectTo = `${location.origin}/login${next ? `?next=${encodeURIComponent(next)}` : ""}`;
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
    if (error) {
      setError(error.message.includes("provider is not enabled") ? "Google sign-in isn't set up for this project yet." : error.message);
      setBusy(false);
    }
  };

  return (
    <div className="narrow">
      <h1 className="page-title">Sign in</h1>
      <button className="btn btn--google btn--big" onClick={google} disabled={busy}>
        <GoogleMark /> {busy ? "Opening Google…" : "Continue with Google"}
      </button>
      <ErrorNote error={error} />
      {phoneEnabled && (
        <>
          <p className="divider">or</p>
          <PhoneSignIn />
        </>
      )}
    </div>
  );
}
