import { Navigate, Outlet, createBrowserRouter } from "react-router-dom";
import { useAuth } from "./auth/AuthProvider";
import { AppShell } from "./components/layout/AppShell";
import { PopShell } from "./components/layout/PopShell";
import { BrushLayout } from "./brush/BrushLayout";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import { SignupPhone, SignupYou, SignupInvite } from "./pages/Signup";
import Onboarding from "./pages/Onboarding";
import Invite from "./pages/Invite";
import Brush from "./pages/Brush";
import Start from "./pages/Start";
import Feed from "./pages/Feed";
import Friends from "./pages/Friends";
import Profile from "./pages/Profile";
import Circle from "./pages/Circle";
import Timeline from "./pages/Timeline";
import Lists from "./pages/Lists";
import Journey, { JourneyDemo } from "./pages/Journey";
import Settings from "./pages/Settings";
import DesignSheet from "./pages/DesignSheet";

// `pop`: pages in the dark pop identity wait on a dark screen, not the light tiles.
function RequireAuth({ onboarded = true, pop = false }: { onboarded?: boolean; pop?: boolean }) {
  const { session, me, loading } = useAuth();
  if (loading || (session && !me)) return <div className={pop ? "pop" : "loading"} aria-busy="true" />;
  // Sign-in lives on the landing page now; it sends signed-in people on to /start.
  if (!session) return <Navigate to="/" replace />;
  if (onboarded && !me!.settings.onboarded_at) return <Navigate to="/onboarding" replace />;
  return <Outlet />;
}

export const router = createBrowserRouter([
  { path: "/", element: <Landing /> },
  { path: "/login", element: <Login /> },
  { path: "/signup", element: <SignupPhone /> },
  { path: "/signup/you", element: <SignupYou /> },
  { path: "/signup/invite", element: <SignupInvite /> },
  { path: "/invite/:token", element: <Invite /> },
  { path: "/design", element: <DesignSheet /> },
  { element: <RequireAuth onboarded={false} />, children: [{ path: "/onboarding", element: <Onboarding /> }] },
  // One brush session spans /start and the pop app, so the timer keeps running on the feed.
  {
    element: <RequireAuth pop />,
    children: [{
      element: <BrushLayout />,
      children: [
        // Full-screen, outside the tab bar: where you start and compose your update.
        { path: "/start", element: <Start /> },
        // The pop app: bottom nav (Brush · Feed · Journey · Friends) + the brushing bar on top.
        {
          element: <PopShell />,
          children: [
            { path: "/feed", element: <Feed /> },
            { path: "/friends", element: <Friends /> },
            { path: "/profile", element: <Profile /> },
            { path: "/journey", element: <Journey /> },
          ],
        },
      ],
    }],
  },
  {
    element: <RequireAuth />,
    children: [{
      element: <AppShell />,
      children: [
        { path: "/brush", element: <Brush /> },
        { path: "/timeline", element: <Timeline /> },
        { path: "/circle", element: <Circle /> },
        { path: "/lists", element: <Lists /> },
        { path: "/settings", element: <Settings /> },
      ],
    }],
  },
  // Public demo of the crew journey in the pop shell, on example data.
  {
    element: <BrushLayout />,
    children: [{ element: <PopShell />, children: [{ path: "/demo/journey", element: <JourneyDemo /> }] }],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);
