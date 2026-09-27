import { describe, expect, it } from "vitest";
import { createDb, loadDbConfig, type OutboundMessage } from "./client.js";

type Call = { fn: string; args: Record<string, unknown> };

// Minimal stand-in for the Supabase client: records calls, answers from a script.
function fakeSupabase(answers: Record<string, (args: Record<string, unknown>) => unknown> = {}) {
  const calls: Call[] = [];
  const client = {
    rpc(fn: string, args: Record<string, unknown> = {}) {
      calls.push({ fn, args });
      try {
        const data = answers[fn] ? answers[fn](args) : null;
        return Promise.resolve({ data, error: null });
      } catch (e) {
        return Promise.resolve({ data: null, error: { message: (e as Error).message } });
      }
    },
  };
  return { client: client as never, calls };
}

const msg = (id: number, body = "hi"): OutboundMessage => ({
  id, user_id: "u1", channel: "imessage", address: "+15550000001", kind: "check_in", body,
  effect: null, check_in_id: "c1", status: "sending", attempts: 1, error: null,
  provider_message_id: null, send_after: "", created_at: "", sent_at: null,
});

describe("loadDbConfig", () => {
  it("reads the two variables", () => {
    expect(loadDbConfig({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" }))
      .toEqual({ url: "https://x.supabase.co", serviceRoleKey: "k" });
  });
  it("names what's missing", () => {
    expect(() => loadDbConfig({ SUPABASE_URL: "https://x.supabase.co" })).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });
});

describe("createDb", () => {
  it("maps inbound events to agent_handle_inbound arguments", async () => {
    const { client, calls } = fakeSupabase({ agent_handle_inbound: () => ({ action: "help", user_id: "u1" }) });
    const res = await createDb(client).handleInbound({ channel: "imessage", address: "(555) 000-0001", text: "hey" });
    expect(res).toEqual({ action: "help", user_id: "u1" });
    expect(calls[0]).toEqual({
      fn: "agent_handle_inbound",
      args: { p_channel: "imessage", p_address: "(555) 000-0001", p_text: "hey", p_reply_to: null, p_reaction: null },
    });
  });

  it("turns database errors into thrown errors", async () => {
    const { client } = fakeSupabase({ run_due_jobs: () => { throw new Error("permission denied"); } });
    await expect(createDb(client).runDueJobs()).rejects.toThrow("run_due_jobs failed: permission denied");
  });

  it("drainOutbox sends each message and records the outcome", async () => {
    const { client, calls } = fakeSupabase({ claim_outbound: () => [msg(1), msg(2, "boom"), msg(3)] });
    const result = await createDb(client).drainOutbox(async (m) => {
      if (m.body === "boom") throw new Error("Target not allowed");
      return { providerMessageId: `spc-msg-${m.id}` };
    });

    expect(result).toEqual({ claimed: 3, sent: 2, failed: 1 });
    const completes = calls.filter((c) => c.fn === "complete_outbound").map((c) => c.args);
    expect(completes).toEqual([
      { p_id: 1, p_ok: true, p_provider_message_id: "spc-msg-1", p_error: null },
      { p_id: 2, p_ok: false, p_provider_message_id: null, p_error: "Target not allowed" },
      { p_id: 3, p_ok: true, p_provider_message_id: "spc-msg-3", p_error: null },
    ]);
  });

  it("drainOutbox does nothing when the outbox is empty", async () => {
    const { client, calls } = fakeSupabase({ claim_outbound: () => [] });
    expect(await createDb(client).drainOutbox(async () => ({ providerMessageId: "x" })))
      .toEqual({ claimed: 0, sent: 0, failed: 0 });
    expect(calls.map((c) => c.fn)).toEqual(["claim_outbound"]);
  });

  it("retries recording a successful send, and never re-sends", async () => {
    let completeCalls = 0;
    let sends = 0;
    const { client } = fakeSupabase({
      claim_outbound: () => [msg(1)],
      complete_outbound: () => { if (++completeCalls < 2) throw new Error("timeout"); return null; },
    });
    const result = await createDb(client).drainOutbox(async () => { sends++; return { providerMessageId: "p1" }; });
    expect(result.sent).toBe(1);
    expect(sends).toBe(1);
    expect(completeCalls).toBe(2);
  });
});
