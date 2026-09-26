// Common provider interface so iMessage / WhatsApp / SMS are swappable behind the agent (FR-D2).

export type Channel = "imessage" | "whatsapp" | "sms";

export interface SendResult {
  providerMessageId: string;
}

export type InboundEvent =
  | {
      type: "text";
      channel: Channel;
      from: string;
      messageId: string;
      text: string;
      // Set for a threaded reply: id of our outbound message it answers (text is then "> …").
      replyTo?: string;
    }
  | {
      type: "reaction";
      channel: Channel;
      from: string;
      messageId: string;
      emoji: string;
      // Id of our outbound message that was tapped back; matches the stored provider message id (FR-D7).
      targetMessageId: string;
    };

export interface MessagingProvider {
  readonly channel: Channel;
  // Throws RecipientNotReachable when the provider refuses the address (don't retry). Providers without effects
  // ignore `effect` (e.g. "confetti" on DONE).
  send(address: string, text: string, options?: { effect?: string | null }): Promise<SendResult>;
  // Inbound events until stop() is called.
  inbound(): AsyncIterable<InboundEvent>;
  stop(): Promise<void>;
}

// The provider will not deliver to this address, e.g. Photon's "Target not allowed for this project"
// before the recipient has texted the shared line. Retrying won't help.
export class RecipientNotReachable extends Error {
  override readonly name = "RecipientNotReachable";
  constructor(
    readonly channel: Channel,
    readonly address: string,
    options?: { cause?: unknown },
  ) {
    super(`${channel} will not deliver to ${address}`, options);
  }
}
