import { Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { useSession } from "../hooks/useSession";
import { useWakeLock } from "../hooks/useWakeLock";
import { BrushContext } from "./BrushContext";

// Wraps /start and the pop app so one brush session lives across them: you start on /start,
// send, and the timer keeps running on the feed until 2:00 (or you end it).
export function BrushLayout() {
  const { me } = useAuth();
  const brush = useSession(me?.id);
  useWakeLock(!!brush.session);
  return (
    <BrushContext.Provider value={brush}>
      <Outlet />
    </BrushContext.Provider>
  );
}
