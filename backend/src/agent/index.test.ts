import { afterEach, describe, expect, it, vi } from "vitest";
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
  return { agent, provider, sent, ...box };
}

afterEach(() => vi.useRealTimers());

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

  it("writes the welcome the database queued with our template, linking to the website", async () => {
    const { agent, sent, enqueue, rows } = setup();
    enqueue({ userId: "u", channel: "imessage", address: SAM, kind: "welcome", body: "[old SQL text]", checkInId: null });
    await agent.drain();
    expect(sent).toEqual([
      {
        address: SAM,
        text:
          "[ℹ️ POST ON THE WEB] You're set up for Toothbrush Connect. Friends' updates will arrive here. Text STOP to opt out." +
          "\nPost yours on the website → http://localhost:5173/timeline",
      },
    ]);
    expect(rows[0].status).toBe("sent");
  });

  it("adds the Join link to brushing-now messages", async () => {
    const { agent, sent, enqueue } = setup();
    const body = "[🪥 BRUSHING NOW] Sahmey is brushing right now.";
    enqueue({ userId: "u", channel: "imessage", address: SAM, kind: "presence_proactive", body, checkInId: null });
    await agent.drain();
    expect(sent[0].text).toBe(`${body} Join → http://localhost:5173/brush`);
  });

  it("passes the database's iMessage effect to the provider", async () => {
    const { agent, sent, enqueue } = setup();
    const body = "[🎉 DONE] Nice brushing!";
    enqueue({ userId: "u", channel: "imessage", address: SAM, kind: "done", body, checkInId: null, effect: "confetti" });
    await agent.drain();
    expect(sent[0]).toEqual({ address: SAM, text: body, effect: "confetti" });
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

  it("claims at most 10 messages at a time", async () => {
    const { agent, sent, enqueue } = setup();
    for (let i = 0; i < 12; i++) enqueue(checkInMsg(SAM));
    await agent.drain();
    expect(sent).toHaveLength(10);
  });

  it("counts a send that hangs as failed after 30 s, and sends the rest of the batch", async () => {
    vi.useFakeTimers();
    const { agent, provider, sent, enqueue, rows } = setup();
    const send = provider.send;
    provider.send = (address, ...rest) => (address === SAM ? new Promise(() => {}) : send(address, ...rest));
    enqueue(checkInMsg(SAM));
    enqueue(checkInMsg(RAVI));

    const draining = agent.drain();
    await vi.advanceTimersByTimeAsync(30_000);
    await draining;
    expect(rows.map((r) => r.status)).toEqual(["pending", "sent"]);
    expect(rows[0].error).toMatch(/30 s/);
    expect(sent.map((s) => s.address)).toEqual([RAVI]);
  });

  it("records a send that gets through after timing out, so the retry doesn't text them again", async () => {
    vi.useFakeTimers();
    const { agent, provider, sent, enqueue, rows } = setup();
    const send = provider.send;
    let deliver!: () => void;
    provider.send = (...args) => new Promise((resolve) => (deliver = () => resolve(send(...args))));
    enqueue(checkInMsg(SAM));

    const draining = agent.drain();
    await vi.advanceTimersByTimeAsync(30_000);
    await draining;
    expect(rows[0].status).toBe("pending");

    deliver();
    await vi.runAllTimersAsync();
    expect(rows[0]).toMatchObject({ status: "sent", providerMessageId: "fake-1", error: undefined });
    await agent.drain();
    expect(sent).toHaveLength(1);
  });

  it("doesn't start a send it already gave up on", async () => {
    vi.useFakeTimers();
    const { agent, sent, enqueue, outbox } = setup();
    const getCheckIn = outbox.getCheckIn;
    let answer!: () => void;
    outbox.getCheckIn = (...args) => new Promise((resolve) => (answer = () => resolve(getCheckIn(...args))));
    enqueue(checkInMsg(SAM));

    const draining = agent.drain();
    await vi.advanceTimersByTimeAsync(30_000);
    await draining;
    answer(); // the check-in lookup finally comes back
    await vi.runAllTimersAsync();
    expect(sent).toHaveLength(0);
  });

  it("retries recording a result after a network blip", async () => {
    vi.useFakeTimers();
    const { agent, sent, enqueue, outbox, rows } = setup();
    const complete = outbox.complete;
    let blips = 2;
    outbox.complete = async (...args) => {
      if (blips-- > 0) throw new Error("fetch failed");
      return complete(...args);
    };
    enqueue(checkInMsg(SAM));

    const draining = agent.drain();
    await vi.runAllTimersAsync();
    await draining;
    expect(rows[0].status).toBe("sent");
    expect(sent).toHaveLength(1);
  });

  it("keeps sending the batch when a result can't be recorded", async () => {
    vi.useFakeTimers();
    const logs: string[] = [];
    const { provider } = createFakeProvider();
    const box = createMemoryOutbox({ "ci-1": checkIn });
    const agent = createAgent({
      provider,
      outbox: box.outbox,
      inbox: createFakeInbox().inbox,
      links: createFixedLinks(),
      log: (l) => logs.push(l),
    });
    const complete = box.outbox.complete;
    box.outbox.complete = async (id, report) => {
      if (id === 1) throw new Error("fetch failed");
      return complete(id, report);
    };
    box.enqueue(checkInMsg(SAM));
    box.enqueue(checkInMsg(RAVI));

    const draining = agent.drain();
    await vi.runAllTimersAsync();
    expect((await draining).map((r) => r.report.ok)).toEqual([true, true]);
    expect(box.rows.map((r) => r.status)).toEqual(["sending", "sent"]);
    expect(logs).toContainEqual(expect.stringMatching(/^recording #1 failed: fetch failed/));
  });
});

describe("memory outbox", () => {
  it("records a success once, and a failure only while the message is out for sending (migration 0008)", async () => {
    const { outbox, enqueue, rows } = createMemoryOutbox();
    enqueue(checkInMsg(SAM));
    await outbox.claim(10);
    await outbox.complete(1, { ok: false, error: "503" });
    await outbox.complete(1, { ok: false, error: "late report" }); // released already: ignored
    expect(rows[0]).toMatchObject({ status: "pending", error: "503" });

    await outbox.complete(1, { ok: true, providerMessageId: "p1" }); // a late success still counts
    await outbox.complete(1, { ok: true, providerMessageId: "p2" });
    expect(rows[0]).toMatchObject({ status: "sent", providerMessageId: "p1", error: undefined });
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
