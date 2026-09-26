import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Db, InboundResult, OutboundMessage } from "../db/client.js";
import { createAgent } from "./index.js";
import { createInboundHandler } from "./inbound/handler.js";
import { createDryRunProvider } from "./providers/dry-run.js";
import { toInboundEvent } from "./providers/imessage.js";
import { hasCatalogLabel } from "./templates/labels.js";
import { replyFor } from "./templates/messages.js";

const RESULTS: InboundResult[] = [
  { action: "verified", user_id: "u", display_name: "Hwaejin", names: ["Sahmey", "Roy", "Florence"] },
  { action: "code_unknown" }, { action: "code_expired", user_id: "u" },
  { action: "phone_mismatch", user_id: "u" }, { action: "phone_taken", user_id: "u" },
  { action: "stopped", user_id: "u" }, { action: "started", user_id: "u" },
  { action: "joined", user_id: "u", names: ["Priya"] }, { action: "nothing_pending", user_id: "u", names: [] },
  { action: "no_update_to_reply", user_id: "u" }, { action: "help", user_id: "u" },
];

describe("templates (FR-D3: label first)", () => {
  it.each(RESULTS.map((r) => [r.action, r] as const))("%s reply is labelled", (_, r) => {
    const reply = replyFor(r, "https://tc.example")!;
    expect(hasCatalogLabel(reply), reply).toBe(true);
  });

  it("stays quiet after reactions and replies", () => {
    expect(replyFor({ action: "reacted", user_id: "u" }, "x")).toBeNull();
    expect(replyFor({ action: "replied", user_id: "u" }, "x")).toBeNull();
  });

  it("names friends in the verified reply without a link", () => {
    const reply = replyFor(RESULTS[0], "https://tc.example")!;
    expect(reply).toContain("Sahmey, Roy and 1 more");
    expect(reply).not.toContain("http");
  });

  const dir = join(import.meta.dirname, "../../supabase/migrations");
  const sql = readdirSync(dir).map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
  const starts = [...new Set([...sql.matchAll(/'(\[[^\]']+\] )/g)].map((m) => m[1]))];
  it("finds the database's message templates", () => expect(starts.length).toBeGreaterThanOrEqual(5));
  it.each(starts)("database template %s uses a catalog label", (s) => expect(hasCatalogLabel(`${s}x`)).toBe(true));
});

describe("Photon inbound mapping", () => {
  const msg = (content: unknown, extra: object = {}) =>
    ({ id: "m1", direction: "inbound", sender: { id: "+15557630903" }, content, ...extra }) as never;

  it("maps text", () => {
    expect(toInboundEvent(msg({ type: "text", text: "Verify 123456" })))
      .toEqual({ channel: "imessage", address: "+15557630903", text: "Verify 123456" });
  });
  it("maps a tapback to a reaction on our message", () => {
    expect(toInboundEvent(msg({ type: "reaction", emoji: "😂", target: { id: "spc-msg-1" } })))
      .toMatchObject({ reaction: "laugh", replyTo: "spc-msg-1", text: null });
  });
  it("maps a threaded reply to a private '>' reply", () => {
    expect(toInboundEvent(msg({ type: "reply", content: { type: "text", text: "call me!" }, target: { id: "spc-msg-2" } })))
      .toMatchObject({ text: ">call me!", replyTo: "spc-msg-2" });
  });
  it("ignores our own messages and read receipts", () => {
    expect(toInboundEvent(msg({ type: "text", text: "hi" }, { direction: "outbound" }))).toBeNull();
    expect(toInboundEvent(msg({ type: "read" }))).toBeNull();
  });
});

function fakeDb(outbox: OutboundMessage[], result: InboundResult = { action: "help", user_id: "u" }): Db {
  let queue = [...outbox];
  const db: Db = {
    claimOutbound: vi.fn(async () => { const q = queue; queue = []; return q; }),
    markSent: vi.fn(async () => {}),
    markFailed: vi.fn(async () => {}),
    handleInbound: vi.fn(async () => result),
    runDueJobs: vi.fn(async () => {}),
    async drainOutbox(send) {
      const msgs = await db.claimOutbound();
      let sent = 0;
      for (const m of msgs) { await send(m); sent++; }
      return { claimed: msgs.length, sent, failed: 0 };
    },
  };
  return db;
}

describe("agent", () => {
  it("sends queued messages through the provider", async () => {
    const lines: string[] = [];
    const provider = createDryRunProvider((l) => lines.push(l));
    const msg = { id: 1, address: "+15557630903", body: "[😄 FUN · today] Sahmey: \"got promoted!!\"", effect: null } as OutboundMessage;
    const agent = createAgent({ db: fakeDb([msg]), provider, siteUrl: "x", log: () => {} });
    await agent.drain();
    expect(lines).toEqual(['[dry-run] → +15557630903: [😄 FUN · today] Sahmey: "got promoted!!"']);
  });

  it("answers 'help' at most once per 12 hours per number", async () => {
    let t = 0;
    const handle = createInboundHandler(fakeDb([]), { siteUrl: "https://tc.example", now: () => t });
    const ev = { channel: "imessage" as const, address: "+1555", text: "hello?" };
    expect(await handle(ev)).toMatch(/^\[ℹ️ POST ON THE WEB\]/);
    t += 60_000;
    expect(await handle(ev)).toBeNull();
    t += 12 * 60 * 60 * 1000;
    expect(await handle(ev)).not.toBeNull();
  });

  it("sends right away after a tapback is relayed", async () => {
    const onQueued = vi.fn();
    const handle = createInboundHandler(fakeDb([], { action: "reacted", user_id: "u" }), { siteUrl: "x", onQueued });
    expect(await handle({ channel: "imessage", address: "+1555", reaction: "love", replyTo: "spc-msg-1" })).toBeNull();
    expect(onQueued).toHaveBeenCalledOnce();
  });
});
