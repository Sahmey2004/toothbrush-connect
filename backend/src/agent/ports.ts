// What the agent needs from the rest of the backend. supabase.ts implements these against the database;
// fakes.ts has in-memory versions for tests and dev.ts.
import type { Mood, Scope } from "../domain/moods.js";
import type { Channel } from "./providers/types.js";
import type { AudienceLabel } from "./templates/labels.js";
import type { VerifyProblem } from "./templates/messages.js";

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
  mood: Mood | null; // null = a text-only check-in (no mood/emoji)
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
  | "help" // anything else
  // "Verify 123456" from the website's phone check (migration 0006)
  | "verified" // number linked to the account
  | VerifyProblem; // code_unknown, code_expired, phone_mismatch, phone_taken

export interface InboundResult {
  action: InboundAction;
  userId: string | null; // null for "code_unknown": the code matched nobody
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

// A phone on Photon's Users list. On shared lines every user gets a line of their own, so `line` is the number
// they must text.
export interface PhotonUser {
  id: string;
  line: string | null;
}

// The provider's list of allowed numbers (Photon project Users).
export interface ContactRegistry {
  // Adds the phone if it's missing (`added`). Null for numbers that are never registered (test data).
  ensure(phone: string, name?: string | null): Promise<(PhotonUser & { added: boolean }) | null>;
}

// Numbers entered on the website and waiting for their "Verify 123456" text (`phone_verifications`, migration
// 0006). The website opens Messages addressed to the user's Photon line, which the agent records here.
export interface PhoneVerifications {
  // Open verifications that don't know their Photon user yet.
  listUnlinked(): Promise<{ userId: string; phone: string; name: string | null }[]>;
  link(userId: string, phone: string, user: PhotonUser): Promise<void>;
}

export interface LinkBuilder {
  // Where a check-in message links on the website (a magic link once FR-W7 exists).
  checkIn(checkInId: string, recipientId: string): string;
  // A page on the website, e.g. "/start".
  page(path: string): string;
}
