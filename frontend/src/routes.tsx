import { Navigate, createBrowserRouter } from "react-router-dom";
import { useAuth } from "./auth/AuthProvider";
import { AccountGate } from "./components/auth/AccountGate";
import { PopShell } from "./components/layout/PopShell";
import { BrushLayout } from "./brush/BrushLayout";
import Landing from "./pages/Landing";
import { SignupPhone, SignupYou, SignupInvite } from "./pages/Signup";
import Invite from "./pages/Invite";
import Start from "./pages/Start";
import Feed from "./pages/Feed";
import Friends from "./pages/Friends";
import Profile from "./pages/Profile";

// Signed-in pages wait on the dark pop screen; AccountGate then finishes setting up a new account.
function RequireAuth() {
  const { session, me, loading } = useAuth();
  if (loading || (session && !me)) return <div className="pop" aria-busy="true" />;
  // Sign-in lives on the landing page; it sends signed-in people on to /start.
  if (!session) return <Navigate to="/" replace />;
  return <AccountGate />;
}

// Addresses of the old pages, still in texts people received, open their replacements.
const MOVED: Record<string, string> = {
  "/brush": "/start",
  "/timeline": "/feed",
  "/circle": "/friends",
  "/lists": "/friends",
  "/settings": "/profile",
  "/login": "/",
  "/onboarding": "/",
};

export const router = createBrowserRouter([
  { path: "/", element: <Landing /> },
  { path: "/signup", element: <SignupPhone /> },
  { path: "/signup/you", element: <SignupYou /> },
  { path: "/signup/invite", element: <SignupInvite /> },
  { path: "/invite/:token", element: <Invite /> },
  // One brush session spans /start and the pop app, so the timer keeps running on the feed.
  {
    element: <RequireAuth />,
    children: [{
      element: <BrushLayout />,
      children: [
        // Full-screen, outside the tab bar: where you start and compose your update.
        { path: "/start", element: <Start /> },
        // The pop app: bottom nav (Brush · Feed · Friends) + the brushing bar on top.
        {
          element: <PopShell />,
          children: [
            { path: "/feed", element: <Feed /> },
            { path: "/friends", element: <Friends /> },
            { path: "/profile", element: <Profile /> },
          ],
        },
      ],
    }],
  },
  ...Object.entries(MOVED).map(([path, to]) => ({ path, element: <Navigate to={to} replace /> })),
  { path: "*", element: <Navigate to="/" replace /> },
]);
