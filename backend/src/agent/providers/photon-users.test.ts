import { describe, expect, it, vi } from "vitest";
import { createFakeInbox, createFakeProvider, createFixedLinks, createMemoryOutbox } from "../fakes.js";
import { createAgent } from "../index.js";
import type { InboundResult } from "../ports.js";
import { createPhotonUsers, PhotonPlanLimit } from "./photon-users.js";

// A fake Spectrum Cloud users API that starts with `existing` phones. With `hold`, creates stay in flight until
// `release()`, like a slow request.
function fakeApi(existing: string[], opts: { full?: boolean; hold?: boolean } = {}) {
  const phones = new Set(existing);
  const calls: { method: string; url: string; body?: unknown; auth: string | null; signal?: AbortSignal | null }[] = [];
  const held: (() => void)[] = [];
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ method, url, body, auth: new Headers(init.headers).get("Authorization"), signal: init.signal });
    if (method === "GET") {
      return Response.json({ succeed: true, data: { users: [...phones].map((phoneNumber) => ({ phoneNumber })) } });
    }
    if (opts.hold) await new Promise<void>((resolve) => held.push(resolve));
    if (opts.full) return new Response("limit", { status: 402 });
    phones.add(body.phoneNumber);
    return Response.json({ succeed: true, data: { phoneNumber: body.phoneNumber } });
  }) as typeof fetch;
  const release = () => {
    opts.hold = false;
    for (const resolve of held.splice(0)) resolve();
  };
  return { fetchImpl, calls, phones, release, posts: () => calls.filter((c) => c.method === "POST") };
}

const SAM = "+13145550101";
const verifyText = { type: "text", channel: "imessage", from: SAM, messageId: "m1", text: "Verify 123456" } as const;
const CONNECTED = expect.stringMatching(/^\[✅ CONNECTED\]/);

const photon = { projectId: "proj", projectSecret: "secret" };

describe("Photon users", () => {
  it("adds a new phone as a shared user, authenticated with the project keys", async () => {
    const api = fakeApi(["+17634060903"]);
    const users = createPhotonUsers(photon, api.fetchImpl);

    expect(await users.ensure("+13145550101", "Sam")).toBe(true);
    const post = api.calls.find((c) => c.method === "POST")!;
    expect(post.url).toBe("https://spectrum.photon.codes/projects/proj/users/");
    expect(post.body).toEqual({ type: "shared", phoneNumber: "+13145550101", firstName: "Sam" });
    expect(post.auth).toBe(`Basic ${Buffer.from("proj:secret").toString("base64")}`);
    expect(api.calls.every((c) => c.signal instanceof AbortSignal)).toBe(true); // requests time out
  });

  it("lists once, then skips phones Photon already has", async () => {
    const api = fakeApi(["+17634060903"]);
    const users = createPhotonUsers(photon, api.fetchImpl);

    expect(await users.ensure("+17634060903")).toBe(false);
    await users.ensure("+13145550101");
    expect(await users.ensure("+13145550101")).toBe(false);
    expect(api.calls.map((c) => c.method)).toEqual(["GET", "POST"]);
  });

  it("never registers fictional 555 numbers from test data", async () => {
    const api = fakeApi([]);
    expect(await createPhotonUsers(photon, api.fetchImpl).ensure("+15550000002", "Sam")).toBe(false);
    expect(api.calls).toHaveLength(0);
  });

  it("reports the plan's user limit", async () => {
    const users = createPhotonUsers(photon, fakeApi([], { full: true }).fetchImpl);
    await expect(users.ensure("+13145550101")).rejects.toBeInstanceOf(PhotonPlanLimit);
  });

  it("shares one create between overlapping calls, and only one of them learns the phone is new", async () => {
    const api = fakeApi([], { hold: true });
    const users = createPhotonUsers(photon, api.fetchImpl);
    const both = [users.ensure(SAM, "Sam"), users.ensure(SAM, "Sam")];
    await vi.waitFor(() => expect(api.posts()).not.toHaveLength(0));
    api.release();
    expect(await Promise.all(both)).toEqual([true, false]);
    expect(api.posts()).toHaveLength(1);
  });

  it("doesn't remember a failed create: calls sharing it fail, and the next call tries again", async () => {
    const opts = { full: true };
    const api = fakeApi([], opts);
    const users = createPhotonUsers(photon, api.fetchImpl);
    const shared = await Promise.allSettled([users.ensure(SAM), users.ensure(SAM)]);
    expect(shared.map((r) => r.status)).toEqual(["rejected", "rejected"]);

    opts.full = false;
    expect(await users.ensure(SAM)).toBe(true);
    expect(api.posts()).toHaveLength(2);
  });
});

describe("agent contact sync", () => {
  function setup(inboxResult: Partial<InboundResult> = {}) {
    const api = fakeApi(["+17634060903"]);
    const registry = createPhotonUsers(photon, api.fetchImpl);
    const { provider, sent } = createFakeProvider();
    const box = createMemoryOutbox();
    const logs: string[] = [];
    const agent = createAgent({
      provider,
      outbox: box.outbox,
      inbox: createFakeInbox(() => inboxResult).inbox,
      links: createFixedLinks(),
      contacts: {
        directory: {
          listPhones: async () => [
            { phone: "+17634060903", name: "Hwaejin" },
            { phone: "+13145550101", name: "Sam" },
            { phone: "+13145550102", name: "Invited Ravi" },
          ],
        },
        registry,
      },
      log: (l) => logs.push(l),
    });
    return { agent, api, registry, provider, sent, logs, ...box };
  }

  it("adds every phone in the database that Photon doesn't have yet", async () => {
    const { agent, api } = setup();
    await agent.syncContacts();
    expect(api.phones).toEqual(new Set(["+17634060903", "+13145550101", "+13145550102"]));
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(2);
  });

  it("never texts anyone, even phones new to Photon: the database queues the welcome (migration 0010)", async () => {
    const { agent, api, sent } = setup();
    await agent.syncContacts();
    await agent.syncContacts();
    expect(api.posts()).toHaveLength(2);
    expect(sent).toEqual([]);
  });

  it("greets a number that verified by texting with ✅ CONNECTED only", async () => {
    const { agent, provider, sent } = setup({ action: "verified", names: [] });
    provider.inbound = async function* () {
      yield verifyText;
    };
    await agent.listen();
    await agent.syncContacts();
    expect(sent.map((s) => s.text)).toEqual([CONNECTED]);
  });

  it("sends a queued welcome to a phone Photon doesn't have yet, registering it first", async () => {
    const { agent, api, sent, enqueue, rows } = setup();
    enqueue({ userId: "u", channel: "imessage", address: SAM, kind: "welcome", body: "[old SQL text]", checkInId: null });
    await agent.drain();
    expect(api.phones.has(SAM)).toBe(true);
    expect(sent.map((s) => s.text)).toEqual([expect.stringMatching(/^\[ℹ️ POST ON THE WEB\] You're set up for Toothbrush Connect\./)]);
    expect(rows[0].status).toBe("sent");
  });

  it("registers a brand-new recipient before sending to them", async () => {
    const { agent, api, sent, enqueue } = setup();
    enqueue({ userId: "u", channel: "imessage", address: "+13145550109", kind: "invite", body: "[👋 INVITE] hi", checkInId: null });
    await agent.drain();
    expect(api.phones.has("+13145550109")).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it("still tries the send if registering fails", async () => {
    const { provider, sent } = createFakeProvider();
    const box = createMemoryOutbox();
    const logs: string[] = [];
    const agent = createAgent({
      provider,
      outbox: box.outbox,
      inbox: createFakeInbox().inbox,
      links: createFixedLinks(),
      contacts: {
        directory: { listPhones: async () => [] },
        registry: createPhotonUsers(photon, fakeApi([], { full: true }).fetchImpl),
      },
      log: (l) => logs.push(l),
    });
    box.enqueue({ userId: "u", channel: "imessage", address: "+13145550109", kind: "invite", body: "[👋 INVITE] hi", checkInId: null });
    await agent.drain();
    expect(logs[0]).toMatch(/registering \+13145550109 with Photon failed: .*limit/);
    expect(sent).toHaveLength(1);
  });
});
