import { useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { ErrorNote } from "../components/common/ErrorNote";

const TIMES = [
  { id: "morning", label: "Morning" },
  { id: "night", label: "Night" },
];

// PRD Flow A: name and usual brushing times.
export default function Onboarding() {
  const { me, refreshMe } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [name, setName] = useState(me?.display_name ?? "");
  const [times, setTimes] = useState<string[]>(["morning", "night"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!me) return null;
  if (me.settings.onboarded_at && !busy) return <Navigate to="/brush" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.completeOnboarding(name, Intl.DateTimeFormat().resolvedOptions().timeZone, times);
      await refreshMe();
      navigate(params.get("next") ?? "/circle", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="narrow">
      <h1 className="page-title">What should friends call you?</h1>
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Name</span>
          <input required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" placeholder="Priya" />
        </label>
        <fieldset className="field">
          <legend>When do you usually brush?</legend>
          <div className="toggles">
            {TIMES.map((t) => (
              <label key={t.id} className={`toggle${times.includes(t.id) ? " is-on" : ""}`}>
                <input type="checkbox" checked={times.includes(t.id)}
                  onChange={(e) => setTimes(e.target.checked ? [...times, t.id] : times.filter((x) => x !== t.id))} />
                {t.label}
              </label>
            ))}
          </div>
        </fieldset>
        <button className="btn btn--primary btn--big" disabled={busy}>{busy ? "Saving…" : "Continue"}</button>
      </form>
      <ErrorNote error={error} />
    </div>
  );
}
