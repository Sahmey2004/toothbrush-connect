import { useEffect, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { signInWithGoogle } from "../lib/auth";
import { savePendingPhone } from "../lib/pendingPhone";
import "../styles/pop.css";

/* The phone-first sign-up flow, in the pop identity. Three screens — phone, name & channel,
   invite — carried forward with router state. The one-time-code screen is intentionally skipped.
   These are the designed sign-up pages; wiring them to real phone auth is a follow-up. */

type FlowData = { phone?: string; name?: string; channel?: string };

/* Keep the whole document dark while any sign-up screen is mounted. */
function usePopBody() {
  useEffect(() => {
    document.body.classList.add("pop-body");
    return () => document.body.classList.remove("pop-body");
  }, []);
}

/* Faint stars, matching the sign-up mockups' 390×844 field. */
function SignupStars() {
  return (
    <svg className="pop__stars" viewBox="0 0 390 844" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <circle cx="40" cy="120" r="2" fill="#FFFFFF" opacity="0.6" />
      <circle cx="360" cy="90" r="2.5" fill="#FFE27A" />
      <circle cx="12" cy="422" r="2" fill="#FFFFFF" opacity="0.5" />
      <circle cx="382" cy="590" r="3" fill="#6FE0E8" />
      <path d="M195 60 Q195 68 203 68 Q195 68 195 76 Q195 68 187 68 Q195 68 195 60 Z" fill="#F272D8" />
    </svg>
  );
}

/* Shared cosmic frame + header (back + 4-step progress). step is the 1-based position. */
function SignupShell({
  step,
  onBack,
  children,
}: {
  step: number;
  onBack?: () => void;
  children: ReactNode;
}) {
  usePopBody();
  return (
    <div className="pop signup">
      <SignupStars />
      <div className="signup__frame">
        <header className="signup__head">
          {onBack ? (
            <button type="button" className="signup__back" aria-label="Back" onClick={onBack}>
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                <path d="M15 9 H4 M9 4 L4 9 L9 14" stroke="#FFFFFF" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ) : (
            <span className="signup__spacer" />
          )}
          <div className="signup__dots" role="img" aria-label={`Step ${step} of 4`}>
            {[1, 2, 3, 4].map((n) => (
              <span
                key={n}
                className={"signup__dot" + (n === step ? " is-active" : n < step ? " is-done" : "")}
              />
            ))}
          </div>
          <span className="signup__spacer" />
        </header>
        <main className="signup__card">{children}</main>
      </div>
    </div>
  );
}

/* ── Step 1: phone ───────────────────────────────────────────────────────── */

function BlobFaces() {
  return (
    <div className="signup__faces">
      <svg width="54" height="54" viewBox="0 0 40 40" aria-hidden="true" style={{ flexShrink: 0 }}>
        <path d="M6 35 C3 21 9 6 20 6 C31 6 37 21 34 35 Z" fill="#6FE0E8" />
        <circle cx="15" cy="19" r="5" fill="#FFFFFF" />
        <circle cx="25" cy="19" r="5" fill="#FFFFFF" />
        <circle cx="15.5" cy="19.5" r="3" fill="#17171C" />
        <circle cx="25.5" cy="19.5" r="3" fill="#17171C" />
        <path d="M13.5 26 Q20 32 26.5 26" stroke="#17171C" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      </svg>
      <svg width="44" height="44" viewBox="0 0 40 40" aria-hidden="true" style={{ flexShrink: 0 }}>
        <g fill="#F272D8">
          <circle cx="31" cy="20" r="6" />
          <circle cx="27.8" cy="27.8" r="6" />
          <circle cx="20" cy="31" r="6" />
          <circle cx="12.2" cy="27.8" r="6" />
          <circle cx="9" cy="20" r="6" />
          <circle cx="12.2" cy="12.2" r="6" />
          <circle cx="20" cy="9" r="6" />
          <circle cx="27.8" cy="12.2" r="6" />
          <circle cx="20" cy="20" r="12" />
        </g>
        <circle cx="15.5" cy="18" r="4.2" fill="#FFFFFF" />
        <circle cx="24.5" cy="18" r="4.2" fill="#FFFFFF" />
        <circle cx="14.4" cy="16.8" r="2.4" fill="#17171C" />
        <circle cx="25.6" cy="19.2" r="2.4" fill="#17171C" />
        <path d="M14.5 26 L17 24 L19.5 26 L22 24 L24.5 26" stroke="#17171C" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export function SignupPhone() {
  const navigate = useNavigate();
  const location = useLocation();
  const prev = (location.state as FlowData) ?? {};
  const [phone, setPhone] = useState(prev.phone ?? "");
  const [agreed, setAgreed] = useState(false);

  const next = () => navigate("/signup/you", { state: { ...prev, phone } });

  return (
    <SignupShell step={1} onBack={() => navigate("/")}>
      <h1 className="signup__title">What's your<br />number?</h1>
      <BlobFaces />
      <p className="signup__lede">
        Add your number so friends' updates can reach you by iMessage or text. Optional — you can add it later in Profile.
      </p>
      <div className="signup__field">
        <label className="signup__label" htmlFor="phone">Phone number <span className="signup__optional">(optional)</span></label>
        <div className="signup__phone-row">
          <span className="signup__cc">+1</span>
          <input
            id="phone"
            className="signup__input"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="(555) 010-2233"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
      </div>
      <label className="signup__check">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        I am 13 or older (16 or older in the EU)
      </label>
      <div className="signup__actions">
        <button
          type="button"
          className="signup__btn signup__btn--primary"
          disabled={!agreed}
          onClick={next}
        >
          Continue
        </button>
      </div>
    </SignupShell>
  );
}

/* ── Step 3: name & channel ──────────────────────────────────────────────── */

const CHANNELS = [
  { id: "imessage", title: "iMessage", sub: "Recommended" },
  { id: "whatsapp", title: "WhatsApp", sub: "For friends without iMessage" },
  { id: "sms", title: "Text message", sub: "SMS" },
  { id: "web", title: "Website only", sub: "Check the site yourself" },
];

export function SignupYou() {
  const navigate = useNavigate();
  const location = useLocation();
  const prev = (location.state as FlowData) ?? {};
  const [name, setName] = useState(prev.name ?? "");
  const [channel, setChannel] = useState(prev.channel ?? "imessage");

  const next = () => navigate("/signup/invite", { state: { ...prev, name, channel } });

  return (
    <SignupShell step={3} onBack={() => navigate("/signup", { state: prev })}>
      <h1 className="signup__title">Nice to<br />meet you</h1>
      <div className="signup__field">
        <label className="signup__label" htmlFor="name">What should friends call you?</label>
        <input
          id="name"
          className="signup__input"
          autoComplete="given-name"
          placeholder="Priya"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <fieldset className="signup__fieldset">
        <legend className="signup__legend">Where should friends' updates reach you?</legend>
        {CHANNELS.map((c) => (
          <label key={c.id} className={"signup__option" + (channel === c.id ? " is-selected" : "")}>
            <input
              type="radio"
              name="channel"
              value={c.id}
              checked={channel === c.id}
              onChange={() => setChannel(c.id)}
            />
            <span className="signup__option-main">
              <span className="signup__option-title">{c.title}</span>
              <span className="signup__option-sub">{c.sub}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="signup__actions">
        <button type="button" className="signup__btn signup__btn--primary" onClick={next}>
          Continue
        </button>
      </div>
    </SignupShell>
  );
}

/* ── Step 4: invite ──────────────────────────────────────────────────────── */

export function SignupInvite() {
  const navigate = useNavigate();
  const location = useLocation();
  const prev = (location.state as FlowData) ?? {};
  const name = (prev.name || "").trim() || "Priya";
  const [shared, setShared] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sign-in is Google through Supabase — the app's single login. Return to "/" afterwards.
  // If a phone was entered earlier, stash it so it survives the OAuth redirect; BrushLayout
  // saves it with set_my_phone once signed in. It's optional — no phone, nothing stashed.
  const finish = async () => {
    const phone = (prev.phone || "").trim();
    if (phone) savePendingPhone(phone);
    const err = await signInWithGoogle("/");
    if (err) setError(err);
  };

  const inviteLink = `${window.location.origin}/invite/demo`;
  const shareLink = async () => {
    const text = `${name} wants to catch up while brushing. Join: ${inviteLink}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Toothbrush Connect", text, url: inviteLink });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(inviteLink);
        setShared(true);
      }
    } catch {
      /* user dismissed the share sheet — no action needed */
    }
  };

  return (
    <SignupShell step={4} onBack={() => navigate("/signup/you", { state: prev })}>
      <h1 className="signup__title">Bring your<br />people</h1>
      <p className="signup__lede">Friends join with one link. Nothing is shared until they accept.</p>
      <div className="signup__group">
        <button type="button" className="signup__btn signup__btn--primary" onClick={shareLink}>
          {shared ? "Link copied!" : "Share invite link"}
        </button>
        <button type="button" className="signup__btn signup__btn--ghost">
          Add by phone number
        </button>
      </div>
      <div className="signup__group">
        <span className="signup__mini-label">WHAT THEY GET</span>
        <div className="signup__bubble">
          <strong>[INVITE]</strong> {name} wants to catch up while brushing. Join:{" "}
          <span className="link">tbc.link/i/{name.toLowerCase().slice(0, 6)}</span>
        </div>
      </div>
      <div className="signup__home">
        <svg width="40" height="40" viewBox="0 0 60 60" aria-hidden="true" style={{ flexShrink: 0 }}>
          <circle cx="30" cy="30" r="27" fill="#FFE27A" />
          <circle cx="42" cy="17" r="5" fill="#F2C94C" />
          <circle cx="18" cy="42" r="3.5" fill="#F2C94C" />
          <circle cx="23" cy="30" r="2.6" fill="#17171C" />
          <circle cx="37" cy="30" r="2.6" fill="#17171C" />
          <path d="M26 38 Q30 41 34 38" stroke="#17171C" strokeWidth="2" fill="none" strokeLinecap="round" />
        </svg>
        <div className="signup__home-main">
          <span className="signup__home-title">Add to Home Screen</span>
          <span className="signup__home-sub">Opens like an app. Optional.</span>
        </div>
        <button type="button" className="signup__home-how">How</button>
      </div>
      <div className="signup__actions">
        {error && <p className="signup__error" role="alert">{error}</p>}
        <button type="button" className="signup__btn signup__btn--primary" onClick={finish}>
          Finish with Google
        </button>
      </div>
    </SignupShell>
  );
}
