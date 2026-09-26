import { describe, expect, it } from "vitest";
import { createFakeInbox, createFakeProvider, createFixedLinks, createMemoryOutbox } from "../fakes.js";
import { createAgent } from "../index.js";
import type { InboundResult } from "../ports.js";
import { createPhotonUsers, PhotonPlanLimit } from "./photon-users.js";

// A fake Spectrum Cloud users API that starts with `existing` phones.
function fakeApi(existing: string[], opts: { full?: boolean } = {}) {
  const phones = new Set(existing);
  const calls: { method: string; url: string; body?: unknown; auth: string | null }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ method, url, body, auth: new Headers(init.headers).get("Authorization") });
    if (method === "GET") {
      return Response.json({ succeed: true, data: { users: [...phones].map((phoneNumber) => ({ phoneNumber })) } });
    }
    if (opts.full) return new Response("limit", { status: 402 });
    phones.add(body.phoneNumber);
    return Response.json({ succeed: true, data: { phoneNumber: body.phoneNumber } });
  }) as typeof fetch;
  return { fetchImpl, calls, phones };
}

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
});

describe("agent contact sync", () => {
  function setup(inboxResult: Partial<InboundResult> = {}) {
    const api = fakeApi(["+17634060903"]);
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
            { phone: "+17634060903", name: "Hwaejin", verified: true },
            { phone: "+13145550101", name: "Sam", verified: true },
            { phone: "+13145550102", name: "Invited Ravi", verified: false },
          ],
        },
        registry: createPhotonUsers(photon, api.fetchImpl),
      },
      log: (l) => logs.push(l),
    });
    return { agent, api, provider, sent, logs, ...box };
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
    expect(sent[0].text).toMatch(/^\[ℹ️ POST ON THE WEB\] You're set up for Toothbrush Connect\./);
  });

  it("doesn't also welcome someone who just verified by texting the line", async () => {
    const { agent, provider, sent } = setup({ action: "verified", names: [] });
    provider.inbound = async function* () {
      yield { type: "text", channel: "imessage", from: "+13145550101", messageId: "m1", text: "Verify 123456" } as const;
    };
    await agent.listen();
    await agent.syncContacts();
    expect(sent.map((s) => s.text)).toEqual([expect.stringMatching(/^\[✅ CONNECTED\]/)]);
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
