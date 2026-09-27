// Database access for the messaging agent (backend/src/agent/).
//
// The agent never touches tables directly. It uses the three service-role functions in
// backend/supabase/migrations/20260926000002_functions.sql:
//
//   claim_outbound        "give me the messages that are due" (marks them 'sending')
//   complete_outbound     "this one was sent" / "this one failed" (failures retry after 30 s, up to 3 tries)
//   agent_handle_inbound  "someone texted the line, what happened?" (STOP, START, YES, tapbacks, '>' replies)
//
// Usage (agent side):
//
//   import { createDb, loadDbConfig } from "../db/client.js";
//   const db = createDb(loadDbConfig(process.env));
//
//   // outbound: every few seconds
//   await db.drainOutbox(async (msg) => {
//     const sent = await provider.send(msg.address, msg.body);
//     return { providerMessageId: sent.id };
//   });
//
//   // inbound: for each Photon event
//   const result = await db.handleInbound({ channel: "imessage", address: sender, text });
//   if (result.action === "help") { /* reply pointing to the website */ }
//
// The service-role key bypasses all row-level security. Keep it on the server; never ship it
// to the website.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

// ── Config ─────────────────────────────────────────────────────────────────────────────────

const DbConfigSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

export interface DbConfig {
  url: string;
  serviceRoleKey: string;
}

export function loadDbConfig(env: Record<string, string | undefined>): DbConfig {
  const parsed = DbConfigSchema.safeParse(env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Database config is missing or invalid: ${missing} (see backend/.env.example)`);
  }
  return { url: parsed.data.SUPABASE_URL, serviceRoleKey: parsed.data.SUPABASE_SERVICE_ROLE_KEY };
}

// ── Types (mirror the SQL) ─────────────────────────────────────────────────────────────────

export type Channel = "imessage" | "whatsapp" | "sms";

/** Values of outbound_messages.kind */
export type OutboundKind =
  | "started" | "done" | "check_in" | "edited" | "invite" | "presence"
  | "presence_proactive" | "reaction" | "reply" | "system";

/** A row of public.outbound_messages, as returned by claim_outbound. */
export interface OutboundMessage {
  id: number;
  user_id: string;
  channel: Channel;
  address: string;            // E.164 phone number
  kind: OutboundKind;
  body: string;               // fully rendered text, label included
  effect: string | null;      // iMessage effect, e.g. "confetti"
  check_in_id: string | null;
  status: "pending" | "sending" | "sent" | "failed" | "skipped";
  attempts: number;
  error: string | null;
  provider_message_id: string | null;
  send_after: string;
  created_at: string;
  sent_at: string | null;
}

/** Tapback types agent_handle_inbound understands. Anything else counts as a heart. */
export type InboundReaction = "love" | "like" | "laugh" | "emphasize" | "dislike" | "question";

export interface InboundEvent {
  channel: Channel;
  address: string;            // sender phone, any format; the database normalizes it
  text?: string | null;
  /** Provider id of our outbound message they replied or tapped back to (Photon `target.id`). */
  replyTo?: string | null;
  reaction?: InboundReaction | null;
}

/** What agent_handle_inbound did. The agent decides what, if anything, to text back. */
export type InboundResult =
  | { action: "stopped"; user_id: string }                 // opted out; confirm once
  | { action: "started"; user_id: string }                 // opted back in
  | { action: "ignored"; user_id: string }                 // opted out, or tapback on something unknown
  | { action: "joined"; user_id: string; names: string[] } // YES accepted pending friend requests
  | { action: "nothing_pending"; user_id: string; names: string[] }
  | { action: "reacted"; user_id: string }                 // tapback relayed to the author
  | { action: "replied"; user_id: string }                 // '>' reply relayed to the author
  | { action: "no_update_to_reply"; user_id: string }
  | { action: "help"; user_id: string }                    // anything else: point them to the website
  // "Verify 123456" (phone verification, migration 0006)
  | { action: "verified"; user_id: string; display_name: string; names: string[] }
  | { action: "code_unknown" }
  | { action: "code_expired"; user_id: string }
  | { action: "phone_mismatch"; user_id: string }             // code texted from a different number
  | { action: "phone_taken"; user_id: string };

export type SendFn = (msg: OutboundMessage) => Promise<{ providerMessageId: string }>;

export interface DrainResult {
  claimed: number;
  sent: number;
  failed: number;
}

export interface Db {
  claimOutbound(limit?: number): Promise<OutboundMessage[]>;
  markSent(id: number, providerMessageId: string): Promise<void>;
  markFailed(id: number, error: string): Promise<void>;
  handleInbound(event: InboundEvent): Promise<InboundResult>;
  /** Releases held check-ins and ends sessions. pg_cron already runs this every 5 s. */
  runDueJobs(): Promise<void>;
  /** Claim due messages, send each with `send`, record the outcome. One failure never stops the rest. */
  drainOutbox(send: SendFn, opts?: { limit?: number }): Promise<DrainResult>;
}

// ── Implementation ─────────────────────────────────────────────────────────────────────────

/** Pass a config for real use, or an existing Supabase client (tests pass a fake). */
export function createDb(configOrClient: DbConfig | Pick<SupabaseClient, "rpc">): Db {
  const sb =
    "rpc" in configOrClient
      ? configOrClient
      : createClient(configOrClient.url, configOrClient.serviceRoleKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

  async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(`${fn} failed: ${error.message}`);
    return data as T;
  }

  const db: Db = {
    async claimOutbound(limit = 50) {
      return (await call<OutboundMessage[] | null>("claim_outbound", { p_limit: limit })) ?? [];
    },

    async markSent(id, providerMessageId) {
      await call("complete_outbound", {
        p_id: id, p_ok: true, p_provider_message_id: providerMessageId, p_error: null,
      });
    },

    async markFailed(id, error) {
      await call("complete_outbound", {
        p_id: id, p_ok: false, p_provider_message_id: null, p_error: error.slice(0, 500),
      });
    },

    async handleInbound(event) {
      return call<InboundResult>("agent_handle_inbound", {
        p_channel: event.channel,
        p_address: event.address,
        p_text: event.text ?? null,
        p_reply_to: event.replyTo ?? null,
        p_reaction: event.reaction ?? null,
      });
    },

    async runDueJobs() {
      await call("run_due_jobs");
    },

    async drainOutbox(send, opts = {}) {
      const messages = await db.claimOutbound(opts.limit);
      let sent = 0;
      let failed = 0;
      for (const msg of messages) {
        let providerMessageId: string;
        try {
          ({ providerMessageId } = await send(msg));
        } catch (err) {
          failed++;
          const reason = err instanceof Error ? err.message : String(err);
          // If recording fails too, claim_outbound releases the claim once its 10-minute lease lapses (migration 0008).
          await db.markFailed(msg.id, reason).catch(() => {});
          continue;
        }
        // Sent: record it, retrying briefly. A row left in 'sending' is re-queued when its 10-minute claim
        // lapses (migration 0008), which would send a duplicate, so this is worth a few tries. Never retry the
        // send itself.
        await retry(() => db.markSent(msg.id, providerMessageId), 3, 500);
        sent++;
      }
      return { claimed: messages.length, sent, failed };
    },
  };

  return db;
}

async function retry<T>(fn: () => Promise<T>, tries: number, delayMs: number): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= tries) throw err;
      await new Promise((r) => setTimeout(r, delayMs * i));
    }
  }
}
