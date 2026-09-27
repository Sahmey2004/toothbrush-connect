import { PassThrough, Writable } from "node:stream";
import type { Message } from "spectrum-ts";
import { describe, expect, it } from "vitest";
import { loadAgentConfig } from "../config.js";
import { toInboundEvent } from "./imessage.js";
import { createTerminalProvider } from "./terminal.js";

// Only the fields toInboundEvent reads.
const msg = (m: object) => ({ id: "spc-msg-1", direction: "inbound", sender: { id: "+17634060903" }, ...m }) as unknown as Message;

describe("loadAgentConfig", () => {
  it("defaults to terminal mode", () => {
    expect(loadAgentConfig({})).toEqual({ mode: "terminal" });
  });

  it("requires Photon credentials in photon mode", () => {
    expect(() => loadAgentConfig({ AGENT_MODE: "photon", PHOTON_PROJECT_ID: "p" })).toThrow(/PHOTON_PROJECT_SECRET/);
    expect(loadAgentConfig({ AGENT_MODE: "photon", PHOTON_PROJECT_ID: "p", PHOTON_PROJECT_SECRET: "s" })).toEqual({
      mode: "photon",
      photon: { projectId: "p", projectSecret: "s" },
    });
  });

  it("rejects unknown modes", () => {
    expect(() => loadAgentConfig({ AGENT_MODE: "carrier-pigeon" })).toThrow();
  });
});

describe("toInboundEvent", () => {
  it("maps inbound text", () => {
    expect(toInboundEvent(msg({ content: { type: "text", text: "STOP" } }))).toEqual({
      type: "text",
      channel: "imessage",
      from: "+17634060903",
      messageId: "spc-msg-1",
      text: "STOP",
    });
  });

  it("maps a tapback to the id of our outbound message", () => {
    const e = toInboundEvent(msg({ content: { type: "reaction", emoji: "❤️", target: { id: "spc-msg-ours" } } }));
    expect(e).toMatchObject({ type: "reaction", emoji: "❤️", targetMessageId: "spc-msg-ours" });
  });

  it("ignores outbound echoes and other content", () => {
    expect(toInboundEvent(msg({ direction: "outbound", content: { type: "text", text: "hi" } }))).toBeNull();
    expect(toInboundEvent(msg({ content: { type: "attachment" } }))).toBeNull();
  });
});

describe("terminal provider", () => {
  it("prints sends and turns stdin lines into inbound texts", async () => {
    let printed = "";
    const out = new Writable({ write: (chunk, _, cb) => ((printed += chunk), cb()) });
    const input = new PassThrough();
    const p = createTerminalProvider({ out, in: input, from: "+15551234567" });

    const { providerMessageId } = await p.send("+15550000000", "[🔑 CODE] 123456");
    expect(printed).toContain("[🔑 CODE] 123456");
    expect(providerMessageId).toMatch(/^terminal-/);

    input.end("\nSTOP\n");
    const events = [];
    for await (const e of p.inbound()) events.push(e);
    expect(events).toMatchObject([{ type: "text", from: "+15551234567", text: "STOP" }]);
  });
});
