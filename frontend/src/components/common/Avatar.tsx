const TILES = ["#CFE9E1", "#F6E3B4", "#E9D3DB", "#D6E4F0", "#E4E0D0"];

export function Avatar({ name, id, size = 44, live = false }: { name: string; id: string; size?: number; live?: boolean }) {
  const initials = (name || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const hue = TILES[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % TILES.length];
  return (
    <span className={`avatar${live ? " avatar--live" : ""}`} style={{ width: size, height: size, background: hue, fontSize: size * 0.38 }}>
      {initials}
      {live && <span className="avatar__brush" aria-hidden>🪥</span>}
    </span>
  );
}
