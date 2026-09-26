// Backend entry: runs the messaging agent. Everything else (auth, data, the 30 s hold) is Supabase.
import { createAgent } from "./agent/index.js";
import { startDevServer } from "./agent/dev-server.js";
import { createDryRunProvider } from "./agent/providers/dry-run.js";
import { createIMessageProvider } from "./agent/providers/imessage.js";
import { loadConfig } from "./config.js";
import { createDb, loadDbConfig } from "./db/client.js";

const config = loadConfig(process.env);
const db = createDb(loadDbConfig(process.env));
const provider = config.photon ? await createIMessageProvider(config.photon) : createDryRunProvider();
if (!config.photon) console.log("PHOTON_PROJECT_ID / PHOTON_PROJECT_SECRET not set: dry-run, messages are only logged");

// Dry-run marks messages as sent without sending them, so it only drains a local database.
const localDb = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(process.env.SUPABASE_URL ?? "");
const sendOutbox = !!config.photon || localDb;
if (!sendOutbox) console.log("dry-run against a hosted database: not touching the outbox (messages stay queued for the real agent)");

const agent = createAgent({ db, provider, siteUrl: config.siteUrl, pollMs: config.pollMs, sendOutbox });
agent.start();
const dev = config.photon ? null : startDevServer(config.devPort, agent.handleInbound);

const shutdown = async () => {
  dev?.close();
  await agent.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
