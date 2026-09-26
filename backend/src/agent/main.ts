// Run the agent until Ctrl-C: send everything the database queues in outbound_messages, and answer texts and
// tapbacks sent to the Photon line.
//   npx tsx --env-file=.env src/agent/main.ts                      # print messages instead of sending
//   AGENT_MODE=photon npx tsx --env-file=.env src/agent/main.ts    # send through Photon
import { loadDatabaseConfig } from "./config.js";
import { createAgent, createProvider } from "./index.js";
import { connectSupabase, createSupabaseInbox, createSupabaseOutbox } from "./supabase.js";

const { db, siteUrl } = loadDatabaseConfig();
const supabase = connectSupabase(db);
const agent = createAgent({
  provider: await createProvider(),
  outbox: createSupabaseOutbox(supabase),
  inbox: createSupabaseInbox(supabase),
  links: { checkIn: () => `${siteUrl}/timeline`, page: (path) => `${siteUrl}${path}` },
});

const stop = new AbortController();
process.once("SIGINT", () => stop.abort());
process.once("SIGTERM", () => stop.abort());

console.log("agent: sending outbound_messages and answering texts (Ctrl-C to stop)");
const listening = agent.listen();
await agent.run({ signal: stop.signal });
await agent.stop(); // ends the inbound stream
await listening;
