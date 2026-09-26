// Messaging agent: sends the database's outbox through a provider (Photon iMessage, or dry-run)
// and answers inbound texts. Product rules (audiences, quiet hours, one invite per 30 days, dedupe)
// already live in the database; the agent is only the bridge to Photon.
import type { Db } from "../db/client.js";
import { createInboundHandler } from "./inbound/handler.js";
import type { MessagingProvider } from "./providers/types.js";

export interface AgentOptions {
  db: Db;
  provider: MessagingProvider;
  siteUrl: string;
  pollMs?: number;
  /** false: leave the outbox alone (dry-run against a shared database would "send" real messages into the void). */
  sendOutbox?: boolean;
  log?: (line: string) => void;
}

export function createAgent({ db, provider, siteUrl, pollMs = 2000, sendOutbox = true, log = console.log }: AgentOptions) {
  let timer: NodeJS.Timeout | undefined;
  let draining: Promise<void> | null = null;

  const drain = () => {
    if (!sendOutbox) return Promise.resolve();
    draining ??= (async () => {
      try {
        // pg_cron runs the 30 s hold every 5 s; running it here too keeps local dev snappy.
        await db.runDueJobs().catch(() => {});
        for (;;) {
          const r = await db.drainOutbox((m) => provider.send({ address: m.address, body: m.body, effect: m.effect }));
          if (r.claimed) log(`outbox: ${r.sent} sent, ${r.failed} failed`);
          if (r.claimed === 0) break;
        }
      } catch (e) {
        log(`outbox drain failed: ${e instanceof Error ? e.message : e}`);
      } finally {
        draining = null;
      }
    })();
    return draining;
  };

  const handleInbound = createInboundHandler(db, { siteUrl, onQueued: () => void drain() });

  return {
    handleInbound,
    drain,
    start() {
      timer = setInterval(drain, pollMs);
      void drain();
      provider.listen(handleInbound).catch((e) => log(`inbound stream ended: ${e}`));
      log(`agent started (provider: ${provider.name}, polling every ${pollMs} ms)`);
    },
    async stop() {
      clearInterval(timer);
      await draining;
      await provider.stop();
    },
  };
}
