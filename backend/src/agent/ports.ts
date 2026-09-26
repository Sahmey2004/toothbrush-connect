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

// What `agent_handle_inbound` decided to do with a text or tapback; the agent answers accordingly.
export type InboundAction =
  | "stopped" // STOP: opted out, pending messages skipped
  | "started" // START: opted back in
  | "joined" // YES: pending invites accepted
  | "nothing_pending" // YES with no invite waiting
  | "reacted" // tapback on a check-in, recorded as a reaction (the author's notice is queued)
  | "replied" // "> text" reply, recorded (the author's notice is queued)
  | "no_update_to_reply"
  | "ignored" // opted out, or a tapback on something that isn't a check-in
  | "help"; // anything else

export interface InboundResult {
  action: InboundAction;
  userId: string;
  names: string[]; // inviters, for "joined"
}

export interface Inbox {
  handle(msg: {
    channel: Channel;
    from: string;
    text: string;
    replyTo: string | null; // provider id of our message that was tapped back
    reaction: string | null; // love, like, dislike, laugh, emphasize, question
  }): Promise<InboundResult>;
}

// Phone numbers the agent should be able to message: iMessage rows of `channel_identities`. `verified` means
// the user proved the number (phone sign-in, or texted the line); invited friends aren't verified yet.
export interface ContactDirectory {
  listPhones(): Promise<{ phone: string; name: string | null; verified: boolean }[]>;
}

// The provider's list of allowed numbers (Photon project Users). True if the phone was newly added.
export interface ContactRegistry {
  ensure(phone: string, name?: string | null): Promise<boolean>;
}

export interface LinkBuilder {
  // Where a check-in message links on the website (a magic link once FR-W7 exists).
  checkIn(checkInId: string, recipientId: string): string;
  // A page on the website, e.g. "/timeline".
  page(path: string): string;
}
