// An invite link survives the trip through Google sign-in: /invite/:token saves the token here, and AccountGate
// accepts it once the person is signed in and set up. The result is shown once in the app bar (PopShell).
const KEY = "tc.pendingInvite";
const NOTICE_KEY = "tc.inviteNotice";

export const savePendingInvite = (token: string) => localStorage.setItem(KEY, token);
export const peekPendingInvite = () => localStorage.getItem(KEY);
export const clearPendingInvite = () => localStorage.removeItem(KEY);

export const saveInviteNotice = (text: string) => sessionStorage.setItem(NOTICE_KEY, text);
export const peekInviteNotice = () => sessionStorage.getItem(NOTICE_KEY);
export const clearInviteNotice = () => sessionStorage.removeItem(NOTICE_KEY);
