import { describe, expect, it } from "vitest";
import { loadDatabaseConfig } from "./config.js";
import { createFakeInbox, createFakeProvider, createFixedLinks, createMemoryOutbox } from "./fakes.js";
import { createAgent, type DeliverableCheckIn } from "./index.js";
import { RecipientNotReachable } from "./providers/types.js";

const checkIn: DeliverableCheckIn = {
  id: "ci-1",
  authorName: "Priya",
  mood: "stressful",
  scope: "today",
  text: "moving apartments, send help",
  audience: "everyone",
};
const SAM = "+15550000001";
const RAVI = "+15550000002";
const checkInMsg = (address: string, userId = address) =>
  ({ userId, channel: "imessage", address, kind: "check_in", body: "[old SQL text]", checkInId: "ci-1" }) as const;

function setup(fail?: (address: string) => Error | null) {
  const { provider, sent } = createFakeProvider(fail);
  const box = createMemoryOutbox({ "ci-1": checkIn });
  const agent = createAgent({
    provider,
    outbox: box.outbox,
    inbox: createFakeInbox().inbox,
    links: createFixedLinks(),
    log: () => {},
  });
  return { agent, sent, ...box };
}

describe("agent.drain", () => {
  it("sends check-ins rendered with our templates, with a link to the website", async () => {
    const { agent, sent, enqueue, rows } = setup();
    enqueue(checkInMsg(SAM));
    enqueue(checkInMsg(RAVI));
    await agent.drain();

    expect(sent.map((s) => s.address)).toEqual([SAM, RAVI]);
    expect(sent[0].text).toBe(
      '[😣 STRESSFUL · today] Priya: "moving apartments, send help"\nReact or share yours → http://localhost:5173/timeline',
    );
    expect(rows.map((r) => r.status)).toEqual(["sent", "sent"]);
    expect(rows[0].providerMessageId).toBe("fake-1");
  });

  it("sends other kinds as the database wrote them", async () => {
    const { agent, sent, enqueue } = setup();
    enqueue({ userId: "u", channel: "imessage", address: SAM, kind: "reaction", body: "[❤️ REACTION] Sam", checkInId: null });
    await agent.drain();
    expect(sent[0].text).toBe("[❤️ REACTION] Sam");
  });

  it("adds the Join link to brushing-now messages", async () => {
    const { agent, sent, enqueue } = setup();
    const body = "[🪥 BRUSHING NOW] Sahmey is brushing right now.";
    enqueue({ userId: "u", channel: "imessage", address: SAM, kind: "presence_proactive", body, checkInId: null });
    await agent.drain();
    expect(sent[0].text).toBe(`${body} Join → http://localhost:5173/brush`);
  });

  it("falls back to the database text if the check-in is gone", async () => {
    const { agent, sent, enqueue } = setup();
    enqueue({ ...checkInMsg(SAM), checkInId: "deleted" });
    await agent.drain();
    expect(sent[0].text).toBe("[old SQL text]");
  });

  it("never sends a message twice", async () => {
    const { agent, sent, enqueue } = setup();
    enqueue(checkInMsg(SAM));
    await agent.drain();
    await agent.drain();
    expect(sent).toHaveLength(1);
  });

  it("puts a failed send back for a retry and keeps sending the rest", async () => {
    let photonDown = true;
    const { agent, sent, enqueue, rows } = setup((a) => (photonDown && a === SAM ? new Error("503") : null));
    enqueue(checkInMsg(SAM));
    enqueue(checkInMsg(RAVI));

    await agent.drain();
    expect(rows.map((r) => r.status)).toEqual(["pending", "sent"]);

    photonDown = false;
    await agent.drain();
    expect(rows.map((r) => r.status)).toEqual(["sent", "sent"]);
    expect(sent.map((s) => s.address)).toEqual([RAVI, SAM]);
  });

  it("gives up after 3 attempts when Photon refuses the number", async () => {
    const { agent, enqueue, rows } = setup((a) => new RecipientNotReachable("imessage", a));
    enqueue(checkInMsg(SAM));
    for (let i = 0; i < 4; i++) await agent.drain();
    expect(rows[0]).toMatchObject({ status: "failed", attempts: 3 });
  });

  it("fails messages for channels it has no provider for", async () => {
    const { agent, sent, enqueue, rows } = setup();
    enqueue({ ...checkInMsg(SAM), channel: "whatsapp" });
    await agent.drain();
    expect(sent).toHaveLength(0);
    expect(rows[0].error).toBe("no whatsapp provider");
  });
});

describe("loadDatabaseConfig", () => {
  const base = { VITE_SUPABASE_URL: "https://x.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_abc" };

  it("reads the frontend's URL variable and defaults the site to the dev server", () => {
    expect(loadDatabaseConfig(base)).toEqual({
      db: { url: "https://x.supabase.co", secretKey: "sb_secret_abc" },
      siteUrl: "http://localhost:5173",
    });
  });

  it("rejects the publishable key", () => {
    expect(() => loadDatabaseConfig({ ...base, SUPABASE_SECRET_KEY: "sb_publishable_abc" })).toThrow(/secret/);
  });

  it("requires a key", () => {
    expect(() => loadDatabaseConfig({ VITE_SUPABASE_URL: base.VITE_SUPABASE_URL })).toThrow(/SUPABASE_SECRET_KEY/);
  });
});
