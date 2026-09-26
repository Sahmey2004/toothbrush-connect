// What the agent needs from the rest of the backend. The backend owners implement these; fakes.ts has
// in-memory versions for tests and dev.ts.
import type { Mood, Scope } from "../domain/moods.js";
import type { AudienceLabel } from "./templates/labels.js";

// A check-in whose 30 s hold has ended, as the recipients will see it.
export interface DeliverableCheckIn {
  id: string;
  authorName: string;
  mood: Mood;
  scope: Scope;
  text: string | null;
  audience: AudienceLabel;
}

export interface Recipient {
  userId: string;
  // E.164 phone for iMessage; null when the user has no phone or receives on the website only.
  phone: string | null;
  // Texted STOP (FR-D6).
  optedOut: boolean;
}

export interface DeliveryKey {
  checkInId: string;
  recipientId: string;
}

// One row per (check-in, recipient), e.g. `outbound_messages` with its unique index.
export interface DeliveryLog {
  // Reserve the send. False if it was already sent, is in flight, or failed permanently, so retries never
  // send twice. A retryable failure can be claimed again.
  claim(key: DeliveryKey): Promise<boolean>;
  markSent(key: DeliveryKey, providerMessageId: string): Promise<void>;
  markFailed(key: DeliveryKey, failure: { error: string; retryable: boolean }): Promise<void>;
}

export interface LinkBuilder {
  // Link that opens this check-in on the website for this recipient (a magic link once FR-W7 exists).
  checkIn(key: DeliveryKey): Promise<string>;
}
