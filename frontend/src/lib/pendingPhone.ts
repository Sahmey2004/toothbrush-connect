// The phone entered during sign-up survives the trip through Google sign-in: SignupInvite saves it
// here before the OAuth redirect, and BrushLayout applies it with set_my_phone once you're signed in.
const KEY = "tc.pendingPhone";

export const savePendingPhone = (phone: string) => localStorage.setItem(KEY, phone);
export const peekPendingPhone = () => localStorage.getItem(KEY);
export const clearPendingPhone = () => localStorage.removeItem(KEY);
