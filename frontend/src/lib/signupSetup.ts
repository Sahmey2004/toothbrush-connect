// What someone entered on the sign-up screens survives the trip through Google sign-in: SignupInvite saves it
// here before the OAuth redirect, and AccountGate finishes setting up the account with it.
import type { Channel } from "../types/api";

const KEY = "tc.pendingSignup";

export interface PendingSignup {
  name?: string;
  channel?: string;
}

export const savePendingSignup = (s: PendingSignup) => localStorage.setItem(KEY, JSON.stringify(s));
export function peekPendingSignup(): PendingSignup | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "null");
  } catch {
    return null;
  }
}
export const clearPendingSignup = () => localStorage.removeItem(KEY);

const CHANNELS: Channel[] = ["imessage", "whatsapp", "sms", "web"];

// complete_onboarding's arguments for a newly signed-in account: the sign-up name, else the Google name, else the
// email's first part (the database refuses an empty name); morning and night brush times.
export function setupFor(
  me: { display_name: string; email: string | null },
  pending: PendingSignup | null,
  timezone: string,
) {
  const name = pending?.name?.trim() || me.display_name.trim() || me.email?.split("@")[0] || "Friend";
  const channel = CHANNELS.find((c) => c === pending?.channel) ?? null;
  return { name, timezone, brushTimes: ["morning", "night"], channel };
}
