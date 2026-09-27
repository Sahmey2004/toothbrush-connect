// The phone entered during sign-up survives the trip through Google sign-in: SignupInvite saves it
// here before the OAuth redirect, and BrushLayout starts verifying it once you're signed in.
const KEY = "tc.pendingPhone";

export const savePendingPhone = (phone: string) => localStorage.setItem(KEY, phone);
export const peekPendingPhone = () => localStorage.getItem(KEY);
export const clearPendingPhone = () => localStorage.removeItem(KEY);

// A sign-up number that couldn't be saved (e.g. it's already on another account). Profile opens the phone
// field with it filled in and the reason shown, instead of the number silently disappearing.
const PROBLEM_KEY = "tc.pendingPhoneProblem";

export const savePhoneProblem = (phone: string, error: string) =>
  localStorage.setItem(PROBLEM_KEY, JSON.stringify({ phone, error }));
export function peekPhoneProblem(): { phone: string; error: string } | null {
  try {
    return JSON.parse(localStorage.getItem(PROBLEM_KEY) ?? "null");
  } catch {
    return null;
  }
}
export const clearPhoneProblem = () => localStorage.removeItem(PROBLEM_KEY);
