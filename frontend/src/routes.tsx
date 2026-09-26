import { Navigate, Outlet, createBrowserRouter, useLocation } from "react-router-dom";
import { useAuth } from "./auth/AuthProvider";
import { AppShell } from "./components/layout/AppShell";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Onboarding from "./pages/Onboarding";
import Invite from "./pages/Invite";
import Brush from "./pages/Brush";
import Circle from "./pages/Circle";
import Timeline from "./pages/Timeline";
import Lists from "./pages/Lists";
import Settings from "./pages/Settings";

function RequireAuth({ onboarded = true }: { onboarded?: boolean }) {
  const { session, me, loading } = useAuth();
  const location = useLocation();
  if (loading || (session && !me)) return <div className="loading" aria-busy="true" />;
  if (!session) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  if (onboarded && !me!.settings.onboarded_at) return <Navigate to="/onboarding" replace />;
  return <Outlet />;
}

export const router = createBrowserRouter([
  { path: "/", element: <Landing /> },
  { path: "/login", element: <Login /> },
  { path: "/invite/:token", element: <Invite /> },
  { element: <RequireAuth onboarded={false} />, children: [{ path: "/onboarding", element: <Onboarding /> }] },
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
  { path: "*", element: <Navigate to="/" replace /> },
]);
