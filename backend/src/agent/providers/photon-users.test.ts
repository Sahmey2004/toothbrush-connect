import { describe, expect, it } from "vitest";
import { createFakeInbox, createFakeProvider, createFixedLinks, createMemoryOutbox } from "../fakes.js";
import { createAgent } from "../index.js";
import { createPhotonUsers, PhotonPlanLimit } from "./photon-users.js";

// A fake Spectrum Cloud users API that starts with `existing` phones. Like Photon's shared pool, it gives every
// user a line of their own.
function fakeApi(existing: string[], opts: { full?: boolean } = {}) {
  const users = new Map<string, { id: string; phoneNumber: string; assignedPhoneNumber: string }>();
  const add = (phoneNumber: string) => {
    const n = users.size + 1;
    users.set(phoneNumber, { id: `user-${n}`, phoneNumber, assignedPhoneNumber: `+1628000000${n}` });
  };
  existing.forEach(add);
  const calls: { method: string; url: string; body?: unknown; auth: string | null }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ method, url, body, auth: new Headers(init.headers).get("Authorization") });
    if (method === "GET") {
      return Response.json({ succeed: true, data: { users: [...users.values()], total: users.size } });
    }
    if (opts.full) return new Response("limit", { status: 402 });
    if (!users.has(body.phoneNumber)) add(body.phoneNumber);
    return Response.json({ succeed: true, data: users.get(body.phoneNumber) });
  }) as typeof fetch;
  return {
    fetchImpl,
    calls,
    get phones() {
      return new Set(users.keys());
    },
  };
}

const photon = { projectId: "proj", projectSecret: "secret" };

describe("Photon users", () => {
  it("adds a new phone as a shared user, authenticated with the project keys", async () => {
    const api = fakeApi(["+17634060903"]);
    const users = createPhotonUsers(photon, api.fetchImpl);

    expect(await users.ensure("+13145550101", "Sam")).toMatchObject({ added: true });
    const post = api.calls.find((c) => c.method === "POST")!;
    expect(post.url).toBe("https://spectrum.photon.codes/projects/proj/users/");
    expect(post.body).toEqual({ type: "shared", phoneNumber: "+13145550101", firstName: "Sam" });
    expect(post.auth).toBe(`Basic ${Buffer.from("proj:secret").toString("base64")}`);
  });

  it("lists once, then skips phones Photon already has", async () => {
    const api = fakeApi(["+17634060903"]);
    const users = createPhotonUsers(photon, api.fetchImpl);

    expect(await users.ensure("+17634060903")).toMatchObject({ added: false });
    await users.ensure("+13145550101");
    expect(await users.ensure("+13145550101")).toMatchObject({ added: false });
    expect(api.calls.map((c) => c.method)).toEqual(["GET", "POST"]);
  });

  it("reports each phone's Photon user and the line assigned to it", async () => {
    const api = fakeApi(["+17634060903"]);
    const users = createPhotonUsers(photon, api.fetchImpl);

    expect(await users.ensure("+17634060903")).toEqual({ id: "user-1", line: "+16280000001", added: false });
    expect(await users.ensure("+17653018970")).toEqual({ id: "user-2", line: "+16280000002", added: true });
    expect(await users.ensure("+17653018970")).toEqual({ id: "user-2", line: "+16280000002", added: false });
  });

  it("never registers fictional 555 numbers from test data", async () => {
    const api = fakeApi([]);
    expect(await createPhotonUsers(photon, api.fetchImpl).ensure("+15550000002", "Sam")).toBeNull();
    expect(api.calls).toHaveLength(0);
  });

  it("reports the plan's user limit", async () => {
    const users = createPhotonUsers(photon, fakeApi([], { full: true }).fetchImpl);
    await expect(users.ensure("+13145550101")).rejects.toBeInstanceOf(PhotonPlanLimit);
  });
});

describe("agent contact sync", () => {
  function setup() {
    const api = fakeApi(["+17634060903"]);
    const { provider, sent } = createFakeProvider();
    const box = createMemoryOutbox();
    const logs: string[] = [];
    const agent = createAgent({
      provider,
      outbox: box.outbox,
      inbox: createFakeInbox().inbox,
      links: createFixedLinks(),
      contacts: {
        directory: {
          listPhones: async () => [
            { phone: "+17634060903", name: "Hwaejin", verified: true },
            { phone: "+13145550101", name: "Sam", verified: true },
            { phone: "+13145550102", name: "Invited Ravi", verified: false },
          ],
        },
        registry: createPhotonUsers(photon, api.fetchImpl),
      },
      log: (l) => logs.push(l),
    });
    return { agent, api, sent, logs, ...box };
  }

  it("adds every phone in the database that Photon doesn't have yet", async () => {
    const { agent, api } = setup();
    await agent.syncContacts();
    expect(api.phones).toEqual(new Set(["+17634060903", "+13145550101", "+13145550102"]));
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(2);
  });

  it("welcomes newly added users who signed up with their phone, once", async () => {
    const { agent, sent } = setup();
    await agent.syncContacts();
    await agent.syncContacts();
    // Hwaejin was already on Photon; invited Ravi gets the invite instead.
    expect(sent.map((s) => s.address)).toEqual(["+13145550101"]);
    expect(sent[0].text).toMatch(/^\[ℹ️ POST ON THE WEB\] You're set up for Moonbrush Connect\./);
    expect(sent[0].text).toMatch(/→ http:\/\/localhost:5173\/start$/);
  });

  it("gives a number waiting to be verified its Photon line, without texting it", async () => {
    const api = fakeApi([]);
    const { provider, sent } = createFakeProvider();
    const linked: unknown[] = [];
    const agent = createAgent({
      provider,
      outbox: createMemoryOutbox().outbox,
      inbox: createFakeInbox().inbox,
      links: createFixedLinks(),
      contacts: {
        directory: { listPhones: async () => [] },
        registry: createPhotonUsers(photon, api.fetchImpl),
        verifications: {
          listUnlinked: async () => [{ userId: "u1", phone: "+17653018970", name: "Sahmey" }],
          link: async (userId, phone, user) => void linked.push({ userId, phone, user }),
        },
      },
      log: () => {},
    });
    await agent.syncContacts();
    expect(api.calls.find((c) => c.method === "POST")?.body).toMatchObject({ phoneNumber: "+17653018970", firstName: "Sahmey" });
    expect(linked).toEqual([{ userId: "u1", phone: "+17653018970", user: { id: "user-1", line: "+16280000001" } }]);
    // Photon can't text them before they text their line; the answer to their "Verify" text is the welcome.
    expect(sent).toHaveLength(0);
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
