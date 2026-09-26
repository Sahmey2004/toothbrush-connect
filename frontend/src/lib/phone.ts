// "+15557630903" → "+1 (555) 763-0903"; other countries are shown as stored.
export function formatPhone(e164: string | null | undefined) {
  if (!e164) return "";
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `+1 (${m[1]}) ${m[2]}-${m[3]}` : e164;
}
