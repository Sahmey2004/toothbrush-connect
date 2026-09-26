import { useEffect, useState } from "react";

// Milliseconds left until `endsAt`, updated every animation frame while running.
export function useCountdown(endsAt: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!endsAt) return;
    let raf = 0;
    const tick = () => {
      setNow(Date.now());
      if (Date.now() < Date.parse(endsAt)) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [endsAt]);
  return endsAt ? Math.max(0, Date.parse(endsAt) - now) : 0;
}

export const formatClock = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
