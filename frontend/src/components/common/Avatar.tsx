// Circular initials avatar. Friends brushing now get a thin gold orbit ring.
const TILES = ["#C9C3EA", "#F1D9B5", "#BFE3DA", "#E9C6C0", "#C9D3E0"];

export function Avatar({ name, id, size = 44, live = false }: { name: string; id: string; size?: number; live?: boolean }) {
  const initials = (name || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const tile = TILES[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % TILES.length];
  return (
    <span className={`avatar${live ? " avatar--live" : ""}`} style={{ width: size, height: size, background: tile, fontSize: size * 0.38 }} aria-hidden="true">
      {initials}
    </span>
  );
}
