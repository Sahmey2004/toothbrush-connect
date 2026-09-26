// Run the agent: send everything the database queues in outbound_messages until Ctrl-C.
//   npx tsx --env-file=.env src/agent/main.ts                      # print messages instead of sending
//   AGENT_MODE=photon npx tsx --env-file=.env src/agent/main.ts    # send through Photon
import { loadDatabaseConfig } from "./config.js";
import { createAgent, createProvider } from "./index.js";
import { connectSupabase, createSupabaseOutbox } from "./supabase.js";

const { db, siteUrl } = loadDatabaseConfig();
const agent = createAgent({
  provider: await createProvider(),
  outbox: createSupabaseOutbox(connectSupabase(db)),
  links: { checkIn: () => `${siteUrl}/timeline` },
});

const stop = new AbortController();
process.once("SIGINT", () => stop.abort());
process.once("SIGTERM", () => stop.abort());

console.log("agent: watching outbound_messages (Ctrl-C to stop)");
await agent.run({ signal: stop.signal });
await agent.stop();
