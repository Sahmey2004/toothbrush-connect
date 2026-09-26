// Common provider interface so iMessage / WhatsApp / SMS are swappable behind the agent.
import type { InboundEvent } from "../../db/client.js";

export interface OutgoingMessage {
  address: string;        // E.164 phone
  body: string;           // fully rendered, label first
  effect?: string | null; // e.g. "confetti"; providers without effects ignore it
}

export type InboundListener = (event: InboundEvent) => Promise<string | null>;

export interface MessagingProvider {
  readonly name: string;
  send(message: OutgoingMessage): Promise<{ providerMessageId: string }>;
  /** Deliver inbound texts and tapbacks to `onEvent`; whatever it returns is sent back as a reply. */
  listen(onEvent: InboundListener): Promise<void>;
  stop(): Promise<void>;
}

/** The recipient hasn't texted our Photon line yet, so Photon won't let us message them. */
export class RecipientNotReachable extends Error {}
