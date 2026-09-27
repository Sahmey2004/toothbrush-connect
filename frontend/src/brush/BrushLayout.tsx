import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { useSession } from "../hooks/useSession";
import { useWakeLock } from "../hooks/useWakeLock";
import { clearPendingPhone, peekPendingPhone, savePhoneProblem } from "../lib/pendingPhone";
import { BrushContext } from "./BrushContext";

// Wraps /start and the pop app so one brush session lives across them: you start on /start,
// send, and the timer keeps running on the feed until 2:00 (or you end it).
export function BrushLayout() {
  const { me, refreshMe } = useAuth();
  const brush = useSession(me?.id);
  useWakeLock(!!brush.session);

  // A phone entered during sign-up (before auth) starts its text-to-verify here once signed in; the
  // app bar then asks them to text us the code. Optional: nothing stashed → nothing happens; an
  // existing number is left alone. If it can't start, Profile shows the number and the reason.
  useEffect(() => {
    if (!me) return;
    const phone = peekPendingPhone();
    if (!phone) return;
    clearPendingPhone();
    if (me.phone) return;
    api.startPhoneVerification(phone)
      .then(() => refreshMe())
      .catch((e) => savePhoneProblem(phone, e instanceof Error ? e.message : String(e)));
  }, [me, refreshMe]);

  return (
    <BrushContext.Provider value={brush}>
      <Outlet />
    </BrushContext.Provider>
  );
}
