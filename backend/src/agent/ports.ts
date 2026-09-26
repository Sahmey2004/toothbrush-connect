// What the agent needs from the rest of the backend. supabase.ts implements these against the database;
// fakes.ts has in-memory versions for tests and dev.ts.
import type { Mood, Scope } from "../domain/moods.js";
import type { Channel } from "./providers/types.js";
import type { AudienceLabel } from "./templates/labels.js";

// A row of `outbound_messages`: the database queues every message the agent sends (README "Messaging agent").
export interface OutboxMessage {
  id: number;
  userId: string;
  channel: Channel;
  address: string;
  kind: string; // check_in, reaction, reply, invite, done, …
  body: string; // text written by the database
  checkInId: string | null;
}

export type SendReport = { ok: true; providerMessageId: string } | { ok: false; error: string };

// A delivered check-in as one recipient sees it.
export interface DeliverableCheckIn {
  id: string;
  authorName: string;
  mood: Mood;
  scope: Scope;
  text: string | null;
  audience: AudienceLabel;
}

export interface Outbox {
  // `claim_outbound`: due, pending messages, marked in flight so no other run sends them. Skips opted-out
  // addresses.
  claim(limit: number): Promise<OutboxMessage[]>;
  // `complete_outbound`: sent, or back to pending for a retry (the database gives up after 3 attempts).
  complete(id: number, report: SendReport): Promise<void>;
  // The check-in behind a `check_in` message, for rendering with our templates. Null if it's gone.
  getCheckIn(checkInId: string, recipientId: string): Promise<DeliverableCheckIn | null>;
}

export interface LinkBuilder {
  // Where a check-in message links on the website (a magic link once FR-W7 exists).
  checkIn(checkInId: string, recipientId: string): string;
}
