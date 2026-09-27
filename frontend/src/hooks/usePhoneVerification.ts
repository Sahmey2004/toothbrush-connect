import { useEffect } from "react";
import { photonVerifyLink } from "../api/client";
import { useAuth } from "../auth/AuthProvider";

// The number waiting for its "Verify 123456" text, if any. While one waits, `me` is refreshed every few seconds:
// first the agent records the user's Photon line (then `link` is ready), then their text links the number.
export function usePhoneVerification() {
  const { me, refreshMe } = useAuth();
  const pending = me?.phone_verification ?? null;
  const waiting = !!pending;

  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => refreshMe().catch(() => {}), 3000);
    return () => clearInterval(t);
  }, [waiting, refreshMe]);

  const link = pending?.photon_user_id ? photonVerifyLink(pending.photon_user_id, pending.code) : null;
  return { pending, link };
}
