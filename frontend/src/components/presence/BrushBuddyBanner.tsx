import { useEffect } from "react";

// FR-P2: shown when a friend starts brushing while you are.
export function BrushBuddyBanner({ name, onDone }: { name: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!name) return;
    const t = setTimeout(onDone, 6000);
    return () => clearTimeout(t);
  }, [name, onDone]);
  if (!name) return null;
  return (
    <div className="buddy" role="status">
      <span className="label">[🪥 BRUSHING NOW]</span> {name} is brushing too 👋
    </div>
  );
}
