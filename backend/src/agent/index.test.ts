import { describe, expect, it } from "vitest";
import { createFakeProvider, createFixedLinks, createMemoryDeliveryLog } from "./fakes.js";
import { createAgent, type DeliverableCheckIn, type Recipient } from "./index.js";
import { RecipientNotReachable } from "./providers/types.js";

const checkIn: DeliverableCheckIn = {
  id: "ci-1",
  authorName: "Priya",
  mood: "stressful",
  scope: "today",
  text: "moving apartments, send help",
  audience: "everyone",
};
const sam: Recipient = { userId: "sam", phone: "+15550000001", optedOut: false };
const ravi: Recipient = { userId: "ravi", phone: "+15550000002", optedOut: false };

function setup(fail?: (address: string) => Error | null) {
  const { provider, sent } = createFakeProvider(fail);
  const deliveries = createMemoryDeliveryLog();
  const agent = createAgent({ provider, deliveries, links: createFixedLinks() });
  return { agent, sent, deliveries };
}

describe("deliverCheckIn", () => {
  it("sends each recipient the labelled update with a link to the check-in", async () => {
    const { agent, sent } = setup();
    const outcomes = await agent.deliverCheckIn(checkIn, [sam, ravi]);

    expect(outcomes.map((o) => o.status)).toEqual(["sent", "sent"]);
    expect(sent.map((s) => s.address)).toEqual([sam.phone, ravi.phone]);
    expect(sent[0].text).toBe(
      '[😣 STRESSFUL · today] Priya: "moving apartments, send help"\nReact or share yours → https://tbc.link/c/ci-1',
    );
  });

  it("skips recipients without a phone or who texted STOP", async () => {
    const { agent, sent } = setup();
    const outcomes = await agent.deliverCheckIn(checkIn, [
      { ...sam, phone: null },
      { ...ravi, optedOut: true },
    ]);
    expect(outcomes).toEqual([
      { recipientId: "sam", status: "skipped", reason: "no_phone" },
      { recipientId: "ravi", status: "skipped", reason: "opted_out" },
    ]);
    expect(sent).toHaveLength(0);
  });

  it("never sends the same check-in to a recipient twice", async () => {
    const { agent, sent } = setup();
    await agent.deliverCheckIn(checkIn, [sam]);
    const again = await agent.deliverCheckIn(checkIn, [sam, ravi]);

    expect(again.map((o) => o.status)).toEqual(["skipped", "sent"]);
    expect(sent).toHaveLength(2);
  });

  it("retries a temporary failure on the next call, and keeps sending to the others", async () => {
    let photonDown = true;
    const { agent, sent } = setup((address) => (photonDown && address === sam.phone ? new Error("503") : null));

    const first = await agent.deliverCheckIn(checkIn, [sam, ravi]);
    expect(first).toMatchObject([{ status: "failed", retryable: true }, { status: "sent" }]);

    photonDown = false;
    const retry = await agent.deliverCheckIn(checkIn, [sam, ravi]);
    expect(retry.map((o) => o.status)).toEqual(["sent", "skipped"]);
    expect(sent.map((s) => s.address)).toEqual([ravi.phone, sam.phone]);
  });

  it("does not retry a recipient Photon refuses", async () => {
    const { agent, sent } = setup((address) => new RecipientNotReachable("imessage", address));

    const first = await agent.deliverCheckIn(checkIn, [sam]);
    expect(first).toMatchObject([{ status: "failed", retryable: false }]);

    const retry = await agent.deliverCheckIn(checkIn, [sam]);
    expect(retry).toMatchObject([{ status: "skipped", reason: "already_sent" }]);
    expect(sent).toHaveLength(0);
  });
});
