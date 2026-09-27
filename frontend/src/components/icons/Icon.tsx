// One line-icon family for the whole site: 24px grid, 2px stroke, rounded caps and joins,
// drawn in currentColor. No emoji anywhere in the UI.
import type { ReactNode } from "react";
import type { Mood } from "../../types/moods";

function star(cx: number, cy: number, outer: number, inner: number) {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? inner : outer;
    const a = (-90 + i * 36) * (Math.PI / 180);
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join("L")}Z`;
}

const PATHS = {
  // Moods
  "mood-stressful": (
    <>
      <path d="M13.2 3.4a5.6 5.6 0 1 0 7.4 7.4 4.6 4.6 0 0 1-7.4-7.4z" />
      <path d="M6.2 19.5h8.3a3.1 3.1 0 0 0 .3-6.2 4.6 4.6 0 0 0-8.8 1.1 2.6 2.6 0 0 0 .2 5.1z" />
      <path d="M10.6 19.5l-1.3 2.3h2.2l-1 1.7" />
    </>
  ),
  "mood-fun": (
    <>
      <path d={star(16.5, 7.5, 4.6, 2)} />
      <path d="M3 20.5c3.6-.6 6.6-2.9 9.3-7.4" />
      <path d="M3.5 15.2c2.1-.5 3.8-1.7 5.2-3.7" />
    </>
  ),
  "mood-boring": (
    <>
      <circle cx="12" cy="11" r="5.5" />
      <path d="M2.5 13.5h19" />
    </>
  ),
  "mood-just_okay": (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" fillOpacity={0.35} />
      <path d="M12 3.5v17" />
    </>
  ),

  // Reactions
  wave: (
    <>
      <path d="M8.5 13.5V7a1.5 1.5 0 0 1 3 0v4.5" />
      <path d="M11.5 11V5.5a1.5 1.5 0 0 1 3 0V11" />
      <path d="M14.5 11V7a1.5 1.5 0 0 1 3 0v6.5a6.5 6.5 0 0 1-6.5 6.5h-.6a5.4 5.4 0 0 1-4.5-2.4L4.3 14a1.5 1.5 0 0 1 2.4-1.8l1.8 2.3" />
      <path d="M19.2 3.6c1 .9 1.6 2 1.8 3.3" />
    </>
  ),
  heart: <path d="M12 20s-7.5-4.5-7.5-10.2A4.3 4.3 0 0 1 12 7.1a4.3 4.3 0 0 1 7.5 2.7C19.5 15.5 12 20 12 20z" />,
  laugh: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.2 10.2c.6-.9 1.6-.9 2.2 0M13.6 10.2c.6-.9 1.6-.9 2.2 0" />
      <path d="M8 13.5h8a4 4 0 0 1-8 0z" />
    </>
  ),
  reply: <path d="M4.5 5.5h15v10h-8.5l-4.5 3.5v-3.5h-2z" />,

  // Navigation
  feed: (
    <>
      <rect x="4" y="4" width="16" height="7" rx="3" />
      <rect x="4" y="14" width="16" height="6" rx="3" />
    </>
  ),
  friends: (
    <>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3.5 19.5a5.5 5.5 0 0 1 11 0" />
      <circle cx="16.8" cy="9.5" r="2.4" />
      <path d="M15.6 14.4a4.4 4.4 0 0 1 4.9 4.6" />
    </>
  ),
  lists: (
    <>
      <path d="M9.5 6.5h10M9.5 12h10M9.5 17.5h10" />
      <circle cx="5" cy="6.5" r="1.2" />
      <circle cx="5" cy="12" r="1.2" />
      <circle cx="5" cy="17.5" r="1.2" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h8.5M17.5 7H20M4 17h2.5M11.5 17H20" />
      <circle cx="15" cy="7" r="2.5" />
      <circle cx="9" cy="17" r="2.5" />
    </>
  ),
  crescent: <path d="M15.8 4.2a8 8 0 1 0 4 13.4 6.4 6.4 0 0 1-4-13.4z" />,

  // Controls
  "chevron-down": <path d="M6.5 9.5l5.5 5.5 5.5-5.5" />,
  "arc-up": (
    <>
      <path d="M4.5 19.5C6.3 12.3 10.4 7.4 17.5 5" />
      <path d="M13 4.3l4.5.7-1 4.4" />
    </>
  ),
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  everyone: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.2 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.2-3.5-8.5S9.6 5.9 12 3.5z" />
    </>
  ),
  land: (
    <>
      <path d="M12 4.5v11" />
      <path d="M7.5 11l4.5 4.5 4.5-4.5" />
      <path d="M5 19.5h14" />
    </>
  ),
  capsule: (
    <>
      <path d="M12 3.5c2.6 2 4 5.1 4 8.8V17H8v-4.7c0-3.7 1.4-6.8 4-8.8z" />
      <circle cx="12" cy="10.5" r="1.6" />
      <path d="M8 14.5l-2.5 2.5v2.5L8 18M16 14.5l2.5 2.5v2.5L16 18M10.5 20.5h3" />
    </>
  ),
  sparkle: <path d="M12 3.5l1.9 6.6 6.6 1.9-6.6 1.9-1.9 6.6-1.9-6.6-6.6-1.9 6.6-1.9z" />,
  pause: <path d="M9 6.5v11M15 6.5v11" />,

  // Journey
  satellite: (
    <g transform="rotate(-45 12 12)">
      <rect x="10" y="8.5" width="4" height="7" rx="1" />
      <rect x="2.5" y="9.5" width="5" height="5" rx="0.5" />
      <rect x="16.5" y="9.5" width="5" height="5" rx="0.5" />
      <path d="M7.5 12h2.5M14 12h2.5M12 8.5V6" />
    </g>
  ),
  orbit: (
    <>
      <circle cx="12" cy="12" r="4" />
      <ellipse cx="12" cy="12" rx="9.5" ry="4" transform="rotate(-20 12 12)" />
    </>
  ),
  flag: (
    <>
      <path d="M6 20.5V3.5" />
      <path d="M6 4.5h11.5l-2.5 3.5 2.5 3.5H6" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;
export const ICON_NAMES = Object.keys(PATHS) as IconName[];

export function Icon({ name, size = 24, className, title }: { name: IconName; size?: number; className?: string; title?: string }) {
  return (
    <svg
      className={`icon${className ? ` ${className}` : ""}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

export const MoodIcon = ({ mood, size }: { mood: Mood; size?: number }) => <Icon name={`mood-${mood}`} size={size} />;
