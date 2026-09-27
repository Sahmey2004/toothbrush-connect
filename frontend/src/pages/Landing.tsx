import { useEffect, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { signInWithGoogle } from "../lib/auth";
import "../styles/pop.css";

/* Faint scattered stars behind the whole page. "slice" keeps the dots round at any width. */
function StarField() {
  return (
    <svg
      className="pop__stars"
      viewBox="0 0 1440 1000"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <circle cx="90" cy="160" r="2.5" fill="#FFFFFF" opacity="0.7" />
      <circle cx="1360" cy="130" r="2" fill="#FFFFFF" opacity="0.6" />
      <circle cx="1390" cy="560" r="3" fill="#FFE27A" />
      <circle cx="60" cy="620" r="2" fill="#FFFFFF" opacity="0.6" />
      <circle cx="720" cy="52" r="2" fill="#FFFFFF" opacity="0.5" />
      <circle cx="40" cy="880" r="4" fill="#6FE0E8" />
      <circle cx="1410" cy="930" r="2.5" fill="#FFFFFF" opacity="0.6" />
      <path d="M1300 70 Q1300 80 1310 80 Q1300 80 1300 90 Q1300 80 1290 80 Q1300 80 1300 70 Z" fill="#FFE27A" />
      <path d="M70 420 Q70 432 82 432 Q70 432 70 444 Q70 432 58 432 Q70 432 70 420 Z" fill="#F272D8" />
      <path
        d="M1382 300 L1374 318 L1386 316 L1378 336"
        stroke="#F272D8"
        strokeWidth="4"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* A little yellow moon-face, the wordmark's companion. */
function BrandMark() {
  return (
    <svg className="pop-brand__mark" width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">
      <circle cx="18" cy="18" r="16" fill="#FFE27A" />
      <circle cx="25" cy="10" r="3.5" fill="#F2C94C" />
      <circle cx="12" cy="18" r="2.6" fill="#17171C" />
      <circle cx="21" cy="18" r="2.6" fill="#17171C" />
    </svg>
  );
}

/* Three friendly faces for the "your friends" social-proof row. */
function Faces() {
  return (
    <svg className="pop-proof__faces" width="92" height="40" viewBox="0 0 92 40" aria-hidden="true">
      <circle cx="20" cy="20" r="18" fill="#F272D8" stroke="#FFFFFF" strokeWidth="3" />
      <circle cx="15" cy="19" r="2.4" fill="#17171C" />
      <circle cx="24" cy="19" r="2.4" fill="#17171C" />
      <circle cx="46" cy="20" r="18" fill="#6FE0E8" stroke="#FFFFFF" strokeWidth="3" />
      <circle cx="41" cy="19" r="2.4" fill="#17171C" />
      <circle cx="50" cy="19" r="2.4" fill="#17171C" />
      <circle cx="72" cy="20" r="18" fill="#FFE27A" stroke="#FFFFFF" strokeWidth="3" />
      <circle cx="67" cy="19" r="2.4" fill="#17171C" />
      <circle cx="76" cy="19" r="2.4" fill="#17171C" />
    </svg>
  );
}

/* The hero: two friends riding a toothbrush rocket from Earth toward a smiling moon. */
function Rocket() {
  return (
    <svg
      width="440"
      height="480"
      viewBox="-10 -10 440 480"
      role="img"
      aria-label="Two friendly characters ride a toothbrush rocket from Earth toward a smiling moon"
    >
      <defs>
        <clipPath id="archClip">
          <path d="M0 470 L0 210 A210 210 0 0 1 420 210 L420 470 Z" />
        </clipPath>
      </defs>
      <path
        d="M30 30 L22 52 L34 50 L26 74"
        stroke="#F272D8"
        strokeWidth="5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M404 20 Q404 34 418 34 Q404 34 404 48 Q404 34 390 34 Q404 34 404 20 Z" fill="#FFE27A" />
      <circle cx="70" cy="6" r="5" fill="#6FE0E8" />
      <path d="M0 470 L0 210 A210 210 0 0 1 420 210 L420 470 Z" fill="#141418" />
      <g clipPath="url(#archClip)">
        <circle cx="120" cy="110" r="2.5" fill="#FFFFFF" />
        <circle cx="200" cy="60" r="2" fill="#FFFFFF" opacity="0.7" />
        <circle cx="80" cy="220" r="2" fill="#FFFFFF" opacity="0.7" />
        <circle cx="390" cy="280" r="3" fill="#FFFFFF" />
        <circle cx="250" cy="420" r="2" fill="#FFFFFF" opacity="0.6" />
        <path d="M160 150 Q160 162 172 162 Q160 162 160 174 Q160 162 148 162 Q160 162 160 150 Z" fill="#FFE27A" />
        <path d="M370 340 Q370 350 380 350 Q370 350 370 360 Q370 350 360 350 Q370 350 370 340 Z" fill="#F272D8" />

        {/* smiling moon */}
        <circle cx="330" cy="120" r="64" fill="#FFE27A" />
        <circle cx="360" cy="92" r="11" fill="#F2C94C" />
        <circle cx="300" cy="84" r="7" fill="#F2C94C" />
        <circle cx="354" cy="158" r="8" fill="#F2C94C" />
        <circle cx="312" cy="126" r="6" fill="#17171C" />
        <circle cx="340" cy="126" r="6" fill="#17171C" />
        <path d="M318 144 Q326 150 334 144" stroke="#17171C" strokeWidth="3" fill="none" strokeLinecap="round" />

        {/* Earth, lower-left */}
        <circle cx="30" cy="520" r="120" fill="#6FE0E8" />
        <ellipse cx="10" cy="428" rx="34" ry="16" fill="#F272D8" />
        <ellipse cx="100" cy="458" rx="20" ry="10" fill="#F272D8" />

        {/* toothbrush rocket + two riders */}
        <g transform="translate(10 -34) rotate(-22 200 330)">
          <line x1="-60" y1="306" x2="-30" y2="306" stroke="#FFFFFF" strokeWidth="4" strokeLinecap="round" opacity="0.5" />
          <line x1="-70" y1="330" x2="-36" y2="330" stroke="#FFFFFF" strokeWidth="4" strokeLinecap="round" opacity="0.5" />
          <line x1="-60" y1="354" x2="-30" y2="354" stroke="#FFFFFF" strokeWidth="4" strokeLinecap="round" opacity="0.5" />
          <path d="M58 316 C30 312 12 298 -12 304 C6 316 4 330 -8 346 C16 342 34 350 58 352 Z" fill="#F272D8" />
          <path d="M58 324 C42 322 30 316 16 318 C28 326 26 334 18 342 C32 340 44 344 58 344 Z" fill="#FFE27A" />
          <rect x="62" y="278" width="9" height="40" rx="4" fill="#6FE0E8" />
          <rect x="76" y="274" width="9" height="44" rx="4" fill="#6FE0E8" />
          <rect x="90" y="278" width="9" height="40" rx="4" fill="#6FE0E8" />
          <rect x="104" y="274" width="9" height="44" rx="4" fill="#6FE0E8" />
          <rect x="56" y="312" width="72" height="40" rx="14" fill="#FFFFFF" />

          {/* pink rider */}
          <g>
            <circle cx="258" cy="290" r="14" fill="#F272D8" />
            <circle cx="250" cy="308" r="14" fill="#F272D8" />
            <circle cx="232" cy="316" r="14" fill="#F272D8" />
            <circle cx="214" cy="308" r="14" fill="#F272D8" />
            <circle cx="206" cy="290" r="14" fill="#F272D8" />
            <circle cx="214" cy="272" r="14" fill="#F272D8" />
            <circle cx="232" cy="264" r="14" fill="#F272D8" />
            <circle cx="250" cy="272" r="14" fill="#F272D8" />
            <circle cx="232" cy="290" r="28" fill="#F272D8" />
            <circle cx="223" cy="284" r="9" fill="#FFFFFF" />
            <circle cx="243" cy="284" r="9" fill="#FFFFFF" />
            <circle cx="225" cy="285" r="5.5" fill="#17171C" />
            <circle cx="245" cy="285" r="5.5" fill="#17171C" />
          </g>
          {/* aqua rider */}
          <g>
            <path d="M270 320 C262 292 272 262 300 260 C330 258 342 290 334 320 Z" fill="#6FE0E8" />
            <path d="M294 262 C294 248 306 246 310 256" stroke="#6FE0E8" strokeWidth="6" fill="none" strokeLinecap="round" />
            <circle cx="293" cy="286" r="9" fill="#FFFFFF" />
            <circle cx="313" cy="286" r="9" fill="#FFFFFF" />
            <circle cx="295" cy="287" r="5.5" fill="#17171C" />
            <circle cx="315" cy="287" r="5.5" fill="#17171C" />
          </g>

          {/* brush head */}
          <rect x="120" y="318" width="224" height="28" rx="14" fill="#FFFFFF" />
          <rect x="164" y="318" width="16" height="28" fill="#FFE27A" />
          <rect x="186" y="318" width="8" height="28" fill="#F272D8" />
        </g>
      </g>
    </svg>
  );
}

/* iOS "slide to answer" control. Slide (or tap Enter) the knob to the end to begin.
   Drag with pointer; keyboard users activate with Enter/Space (click with detail === 0). */
function SlideToStart({ onComplete }: { onComplete: () => void }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [maxX, setMaxX] = useState(0);
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const xRef = useRef(0);
  const draggingRef = useRef(false);
  const startRef = useRef(0);
  const doneRef = useRef(false);

  useEffect(() => {
    const measure = () => {
      const el = trackRef.current;
      if (el) setMaxX(Math.max(0, el.clientWidth - 64)); // track width − (knob 56 + 2×4 inset)
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const setPos = (v: number) => {
    xRef.current = v;
    setX(v);
  };

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    setPos(maxX);
    onComplete();
  };

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (doneRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    setDragging(true);
    startRef.current = e.clientX - xRef.current;
  };
  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!draggingRef.current) return;
    setPos(Math.min(maxX, Math.max(0, e.clientX - startRef.current)));
  };
  const onPointerUp = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    if (maxX > 0 && xRef.current >= maxX * 0.85) finish();
    else setPos(0);
  };

  const progress = maxX > 0 ? x / maxX : 0;

  return (
    <div className="pop-slide" ref={trackRef}>
      <span className="pop-slide__label" style={{ opacity: 1 - Math.min(1, progress * 1.6) }}>
        Slide to get started
        <svg className="pop-slide__chevrons" width="34" height="14" viewBox="0 0 34 14" aria-hidden="true">
          <path d="M2 2 L8 7 L2 12 M13 2 L19 7 L13 12 M24 2 L30 7 L24 12"
            stroke="#c2c7cf" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <button
        type="button"
        className={"pop-slide__knob" + (dragging ? " is-dragging" : "")}
        style={{ transform: `translateX(${x}px)` }}
        aria-label="Get started"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={(e) => { if (e.detail === 0) finish(); }} // keyboard Enter/Space only
      >
        <svg width="22" height="22" viewBox="0 0 18 18" aria-hidden="true">
          <path d="M3 9 H14 M9 4 L14 9 L9 14" stroke="#0B3036" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}

export default function Landing() {
  const { session, me } = useAuth();
  // Keep the cosmic backdrop edge-to-edge (incl. overscroll) while this page is mounted.
  useEffect(() => {
    document.body.classList.add("pop-body");
    return () => document.body.classList.remove("pop-body");
  }, []);
  const [error, setError] = useState<string | null>(null);
  // Returning from Google sign-in can land here; send signed-in people into the app.
  if (session && me) return <Navigate to={me.settings.onboarded_at ? "/start" : "/onboarding"} replace />;

  // The one and only sign-in: Google through Supabase. Return to "/" so the pop landing routes onward.
  const doSignIn = async () => {
    const err = await signInWithGoogle("/");
    if (err) setError(err);
  };

  return (
    <div className="pop">
      <StarField />
      <div className="pop__wrap">
        <nav className="pop-nav">
          <Link className="pop-brand" to="/">
            <BrandMark />
            <span className="pop-brand__word">toothbrush connect</span>
          </Link>
          <button type="button" className="pop-login" onClick={doSignIn}>Log in</button>
        </nav>

        <main className="pop-main">
          <section className="pop-hero">
            <div className="pop-hero__copy">
              <span className="pop-eyebrow">Two minutes for the friends you miss</span>
              <h1 className="pop-hero__title">
                Fly me to<br />the moon.
              </h1>
              <p className="pop-hero__lede">
                Start your brush timer, share how today's going in one tap, then catch up on your
                friends' updates. Nothing to install.
              </p>
              <SlideToStart onComplete={doSignIn} />
              {error && <p className="pop-error" role="alert">{error}</p>}
              <div className="pop-proof">
                <Faces />
                <span className="pop-proof__text">
                  Friends' updates also arrive in iMessage, WhatsApp or SMS
                </span>
              </div>
            </div>

            <div className="pop-hero__art">
              <Rocket />
            </div>
          </section>
        </main>

        <footer className="pop-foot">
          No streaks, no likes, no public profiles. Text STOP any time.
        </footer>
      </div>
    </div>
  );
}
