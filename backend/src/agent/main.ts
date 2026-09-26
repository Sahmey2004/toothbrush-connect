// Run the agent until Ctrl-C: send everything the database queues in outbound_messages, and answer texts and
// tapbacks sent to the Photon line.
//   npx tsx --env-file=.env src/agent/main.ts                      # print messages instead of sending
//   AGENT_MODE=photon npx tsx --env-file=.env src/agent/main.ts    # send through Photon
import { writeSync } from "node:fs";
import { loadDatabaseConfig } from "./config.js";
import { createAgent, createContactRegistry, createProvider } from "./index.js";
import { connectSupabase, createSupabaseContacts, createSupabaseInbox, createSupabaseOutbox } from "./supabase.js";

// Synchronous writes, so log lines show up immediately even when stdout is a pipe (async on macOS).
const log = (line: string) => writeSync(1, `${new Date().toISOString()} ${line}\n`);

const { db, siteUrl } = loadDatabaseConfig();
const supabase = connectSupabase(db);
const agent = createAgent({
  provider: await createProvider(),
  outbox: createSupabaseOutbox(supabase),
  inbox: createSupabaseInbox(supabase),
  contacts: { directory: createSupabaseContacts(supabase), registry: createContactRegistry() },
  links: { checkIn: () => `${siteUrl}/timeline`, page: (path) => `${siteUrl}${path}` },
  log,
});

const stop = new AbortController();
process.once("SIGINT", () => stop.abort());
process.once("SIGTERM", () => stop.abort());

log("agent: sending outbound_messages and answering texts (Ctrl-C to stop)");
const listening = agent.listen();
await agent.run({ signal: stop.signal });
await agent.stop(); // ends the inbound stream
await listening;
