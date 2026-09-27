// The public website. Links people text to friends point here, even from the dev server, since friends can't
// open localhost. VITE_SITE_URL overrides it (e.g. for a preview deploy).
export const SITE_URL = ((import.meta.env.VITE_SITE_URL as string | undefined) || "https://toothbrush-connect.vercel.app")
  .replace(/\/$/, "");

export const inviteUrl = (token: string) => `${SITE_URL}/invite/${encodeURIComponent(token)}`;
