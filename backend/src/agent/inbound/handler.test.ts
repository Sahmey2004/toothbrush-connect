import { describe, expect, it } from "vitest";
import { createFakeInbox, createFakeProvider, createFixedLinks } from "../fakes.js";
import type { InboundResult } from "../ports.js";
import type { InboundEvent } from "../providers/types.js";
import { AUTO_REPLY_EVERY_MS, createInboundHandler } from "./handler.js";

const ME = "+17634060903";
const text = (t: string): InboundEvent => ({ type: "text", channel: "imessage", from: ME, messageId: "m", text: t });

function setup(result: Partial<InboundResult> = {}) {
  let clock = 0;
  const { provider, sent } = createFakeProvider();
  const { inbox, handled } = createFakeInbox(() => result);
  const handle = createInboundHandler({ provider, inbox, links: createFixedLinks(), now: () => clock });
  return { handle, sent, handled, advance: (ms: number) => (clock += ms) };
}

describe("inbound handler", () => {
  it("passes texts to the database and confirms STOP", async () => {
    const { handle, sent, handled } = setup({ action: "stopped" });
    await handle(text("stop"));
    expect(handled).toEqual([{ channel: "imessage", from: ME, text: "stop", replyTo: null, reaction: null }]);
    expect(sent[0].address).toBe(ME);
    expect(sent[0].text).toMatch(/^\[ℹ️ POST ON THE WEB\] You won't get more messages here\. Text START/);
  });

  it("welcomes someone who replied YES to an invite, naming the inviter", async () => {
    const { handle, sent } = setup({ action: "joined", names: ["Sahmey"] });
    await handle(text("YES"));
    expect(sent[0].text).toMatch(/^\[👋 INVITE\] You're in Sahmey's circle\./);
  });

  it("maps a tapback to the reaction name and the id of our message", async () => {
    const { handle, sent, handled } = setup({ action: "reacted" });
    await handle({ type: "reaction", channel: "imessage", from: ME, messageId: "r", emoji: "😂", targetMessageId: "spc-msg-1" });
    expect(handled[0]).toMatchObject({ text: "", replyTo: "spc-msg-1", reaction: "laugh" });
    expect(sent).toHaveLength(0); // the author's notice goes through the outbox
  });

  it("auto-replies to other texts at most once per 12 hours (FR-D5)", async () => {
    const { handle, sent, advance } = setup({ action: "help" });
    await handle(text("hey what's up"));
    await handle(text("hello?"));
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toMatch(/^\[ℹ️ POST ON THE WEB\]/);

    advance(AUTO_REPLY_EVERY_MS);
    await handle(text("still there?"));
    expect(sent).toHaveLength(2);
  });

  it("stays quiet when the database ignores the message (e.g. opted out)", async () => {
    const { handle, sent } = setup({ action: "ignored" });
    expect(await handle(text("hi"))).toBeNull();
    expect(sent).toHaveLength(0);
  });
});
