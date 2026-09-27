import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { useSession } from "../hooks/useSession";
import { useWakeLock } from "../hooks/useWakeLock";
import { clearPendingPhone, peekPendingPhone } from "../lib/pendingPhone";
import { BrushContext } from "./BrushContext";

// Wraps /start and the pop app so one brush session lives across them: you start on /start,
// send, and the timer keeps running on the feed until 2:00 (or you end it).
export function BrushLayout() {
  const { me, refreshMe } = useAuth();
  const brush = useSession(me?.id);
  useWakeLock(!!brush.session);

  // A phone entered during sign-up (before auth) is saved here once signed in. Optional:
  // nothing stashed → nothing happens; an existing number is left alone.
  useEffect(() => {
    if (!me) return;
    const phone = peekPendingPhone();
    if (!phone) return;
    clearPendingPhone();
    if (me.phone) return;
    api.setMyPhone(phone).then(() => refreshMe()).catch(() => {});
  }, [me, refreshMe]);

  return (
    <BrushContext.Provider value={brush}>
      <Outlet />
    </BrushContext.Provider>
  );
}
