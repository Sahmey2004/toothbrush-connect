// Manual check: deliver a sample check-in to one phone with the provider AGENT_MODE picks.
//   npx tsx --env-file=.env src/agent/dev.ts                          # terminal (default)
//   AGENT_MODE=photon npx tsx --env-file=.env src/agent/dev.ts +1…     # live iMessage to that phone
// The phone must have texted the Photon line first, or Photon refuses the send.
import { createFixedLinks, createMemoryDeliveryLog } from "./fakes.js";
import { createAgent, createProvider } from "./index.js";

const phone = process.argv[2] ?? "+15550000000";

const agent = createAgent({
  provider: await createProvider(),
  deliveries: createMemoryDeliveryLog(),
  links: createFixedLinks(),
});

try {
  const outcomes = await agent.deliverCheckIn(
    {
      id: "dev-check-in",
      authorName: "Priya",
      mood: "stressful",
      scope: "today",
      text: "moving apartments, send help",
      audience: "everyone",
    },
    [{ userId: "dev-recipient", phone, optedOut: false }],
  );
  console.log("\n", outcomes);
} finally {
  await agent.stop();
}
