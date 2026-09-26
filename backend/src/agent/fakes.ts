// In-memory ports for tests and dev.ts. The outbox mirrors claim_outbound / complete_outbound in
// supabase/migrations/20260926000002_functions.sql.
import type { DeliverableCheckIn, Inbox, InboundResult, LinkBuilder, Outbox, OutboxMessage } from "./ports.js";
import type { MessagingProvider, SendResult } from "./providers/types.js";

export interface FakeRow extends OutboxMessage {
  status: "pending" | "sending" | "sent" | "failed";
  attempts: number;
  providerMessageId?: string;
  error?: string;
}

export function createMemoryOutbox(checkIns: Record<string, DeliverableCheckIn> = {}) {
  const rows: FakeRow[] = [];
  let nextId = 1;
  const outbox: Outbox = {
    async claim(limit) {
      const due = rows.filter((r) => r.status === "pending").slice(0, limit);
      for (const r of due) {
        r.status = "sending";
        r.attempts++;
      }
      return due.map(({ status, attempts, providerMessageId, error, ...m }) => m);
    },
    async complete(id, report) {
      const r = rows.find((x) => x.id === id)!;
      if (report.ok) {
        r.status = "sent";
        r.providerMessageId = report.providerMessageId;
      } else {
        r.status = r.attempts >= 3 ? "failed" : "pending";
        r.error = report.error;
      }
    },
    async getCheckIn(checkInId) {
      return checkIns[checkInId] ?? null;
    },
  };
  return {
    outbox,
    rows,
    enqueue(m: Omit<OutboxMessage, "id">) {
      rows.push({ ...m, id: nextId++, status: "pending", attempts: 0 });
    },
  };
}

export function createFixedLinks(base = "http://localhost:5173"): LinkBuilder {
  return { checkIn: () => `${base}/timeline`, page: (path) => `${base}${path}` };
}

// Records what it was asked to handle and answers with `decide`.
export function createFakeInbox(decide: (text: string, reaction: string | null) => Partial<InboundResult> = () => ({})) {
  const handled: Parameters<Inbox["handle"]>[0][] = [];
  const inbox: Inbox = {
    async handle(msg) {
      handled.push(msg);
      return { action: "help", userId: `user:${msg.from}`, names: [], ...decide(msg.text, msg.reaction) };
    },
  };
  return { inbox, handled };
}

// Records sends; `fail` decides per address whether a send throws.
export function createFakeProvider(fail: (address: string) => Error | null = () => null) {
  const sent: { address: string; text: string; effect?: string }[] = [];
  let n = 0;
  const provider: MessagingProvider = {
    channel: "imessage",
    async send(address, text, options): Promise<SendResult> {
      const error = fail(address);
      if (error) throw error;
      sent.push({ address, text, ...(options?.effect ? { effect: options.effect } : {}) });
      return { providerMessageId: `fake-${++n}` };
    },
    async *inbound() {},
    async stop() {},
  };
  return { provider, sent };
}
