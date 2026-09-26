// Entry for inbound Photon messages: the database decides what happened, we pick the reply.
import type { Db, InboundEvent } from "../../db/client.js";
import { replyFor } from "../templates/messages.js";

const HELP_COOLDOWN_MS = 12 * 60 * 60 * 1000; // FR-D5: one "post on the web" reply per 12 h

export function createInboundHandler(db: Db, opts: { siteUrl: string; onQueued?: () => void; now?: () => number }) {
  const lastHelp = new Map<string, number>();
  const now = opts.now ?? Date.now;

  return async (event: InboundEvent): Promise<string | null> => {
    const result = await db.handleInbound(event);
    // A reaction or reply queues a message to the author; send it now instead of on the next poll.
    if (result.action === "reacted" || result.action === "replied") opts.onQueued?.();
    if (result.action === "help") {
      const last = lastHelp.get(event.address);
      if (last !== undefined && now() - last < HELP_COOLDOWN_MS) return null;
      lastHelp.set(event.address, now());
    }
    return replyFor(result, opts.siteUrl);
  };
}
