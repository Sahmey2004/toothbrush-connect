// An invite link survives the trip through Google sign-in: /invite/:token saves the token here, and
// the app accepts it once the person is signed in and set up (AppShell).
const KEY = "tc.pendingInvite";

export const savePendingInvite = (token: string) => localStorage.setItem(KEY, token);
export const peekPendingInvite = () => localStorage.getItem(KEY);
export const clearPendingInvite = () => localStorage.removeItem(KEY);
