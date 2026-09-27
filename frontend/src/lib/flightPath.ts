// A cubic Bézier flight path, sampled by arc length so distance on screen matches distance flown.
export type Pt = readonly [number, number];

export function flightPath(P: readonly [Pt, Pt, Pt, Pt], samples = 160) {
  const bez = (t: number) => {
    const u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return [a * P[0][0] + b * P[1][0] + c * P[2][0] + d * P[3][0], a * P[0][1] + b * P[1][1] + c * P[2][1] + d * P[3][1]];
  };
  const pts: { x: number; y: number; len: number }[] = [];
  let len = 0;
  let [px, py] = bez(0);
  for (let i = 0; i <= samples; i++) {
    const [x, y] = bez(i / samples);
    len += Math.hypot(x - px, y - py);
    pts.push({ x, y, len });
    [px, py] = [x, y];
  }
  const total = len;

  // Position and heading (degrees, 0 = pointing right) at a fraction of the whole path.
  const at = (fraction: number) => {
    const target = Math.max(0, Math.min(1, fraction)) * total;
    const i = Math.max(1, pts.findIndex((s) => s.len >= target));
    const a = pts[i - 1], b = pts[i] ?? a;
    const k = b.len === a.len ? 0 : (target - a.len) / (b.len - a.len);
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, heading: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI };
  };

  // SVG polyline points for the stretch between two fractions.
  const trail = (from: number, to: number) => {
    const mid = pts.filter((s) => s.len > from * total && s.len < to * total);
    return [at(from), ...mid, at(to)].map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  };

  return { at, trail };
}
