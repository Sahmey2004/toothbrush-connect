// Manual check without the database: send one message to a phone with the provider AGENT_MODE picks.
//   npx tsx --env-file=.env src/agent/dev.ts                                  # sample check-in, terminal
//   AGENT_MODE=photon npx tsx --env-file=.env src/agent/dev.ts +1…             # sample check-in, live iMessage
//   AGENT_MODE=photon npx tsx --env-file=.env src/agent/dev.ts welcome +1…     # welcome text, live iMessage
// The phone must be on the Photon project's Users list, or Photon refuses the send.
import { loadSiteUrl } from "./config.js";
import { createFakeInbox, createMemoryOutbox } from "./fakes.js";
import { createAgent, createProvider, createSiteLinks } from "./index.js";

const welcome = process.argv[2] === "welcome";
const phone = process.argv[welcome ? 3 : 2] ?? "+15550000000";

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

const agent = createAgent({
  provider: await createProvider(),
  outbox,
  inbox: createFakeInbox().inbox,
  links: createSiteLinks(loadSiteUrl()),
});
try {
  if (welcome) await agent.sendWelcome(phone);
  else await agent.drain();
} finally {
  await agent.stop();
}
