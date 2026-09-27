import { useAuth } from "../auth/AuthProvider";
import { usePresence } from "../hooks/usePresence";
import { FeedView } from "../components/feed/FeedView";

// FR-S4: 14 days of updates the viewer received, and nothing else.
export default function Timeline() {
  const { me } = useAuth();
  const { feed, loaded, brushingNow } = usePresence(me?.id);
  return (
    <FeedView feed={feed} loaded={loaded}
      brushingNow={brushingNow.map((f) => ({ id: f.friend_id, name: f.display_name || "A friend" }))} />
  );
}
