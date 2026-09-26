// Manual check without the database: queue one check-in message for a phone and send it with the provider
// AGENT_MODE picks.
//   npx tsx --env-file=.env src/agent/dev.ts                          # terminal (default)
//   AGENT_MODE=photon npx tsx --env-file=.env src/agent/dev.ts +1…     # live iMessage to that phone
// The phone must have texted the Photon line first, or Photon refuses the send.
import { createFixedLinks, createMemoryOutbox } from "./fakes.js";
import { createAgent, createProvider } from "./index.js";

const phone = process.argv[2] ?? "+15550000000";

const { outbox, enqueue } = createMemoryOutbox({
  "dev-check-in": {
    id: "dev-check-in",
    authorName: "Priya",
    mood: "stressful",
    scope: "today",
    text: "moving apartments, send help",
    audience: "everyone",
  },
});
enqueue({ userId: "dev-recipient", channel: "imessage", address: phone, kind: "check_in", body: "", checkInId: "dev-check-in" });

const agent = createAgent({ provider: await createProvider(), outbox, links: createFixedLinks() });
try {
  await agent.drain();
} finally {
  await agent.stop();
}
