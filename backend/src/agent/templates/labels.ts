// Label catalog: every message the line sends starts with one of these (PRD v3 FR-D3).
// ✅ CONNECTED and 🔕 STOPPED are agent replies to phone verification and STOP/START.
export const LABELS = [
  "😄 FUN", "😣 STRESSFUL", "😐 BORING", "🙂 JUST OKAY",
  "👥 CLOSE CIRCLE", "💌 JUST FOR YOU", "📦 3 UPDATES",
  "🪥 BRUSHING NOW", "✏️ EDITED", "❤️ REACTION", "💬 REPLY",
  "🔑 CODE", "👋 INVITE", "📬 DIGEST", "ℹ️ POST ON THE WEB", "🎉 DONE",
  "✅ CONNECTED", "🔕 STOPPED",
] as const;

/** "[😄 FUN · this week] Aisha: …" → true */
export function hasCatalogLabel(body: string): boolean {
  const m = /^\[([^\]]+)\] /.exec(body);
  return !!m && LABELS.some((l) => m[1] === l || m[1].startsWith(`${l} ·`));
}
