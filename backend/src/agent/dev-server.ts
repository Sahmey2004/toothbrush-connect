// Dry-run only: pretend someone texted the line.
//   curl -XPOST localhost:8787/dev/inbound -H 'content-type: application/json' \
//        -d '{"from":"+15557630903","text":"Verify 123456"}'
import { createServer } from "node:http";
import type { InboundEvent } from "../db/client.js";

export function startDevServer(port: number, handle: (e: InboundEvent) => Promise<string | null>) {
  const server = createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/dev/inbound") {
      res.writeHead(404).end();
      return;
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    try {
      const { from, text = "", replyTo = null, reaction = null } = JSON.parse(raw || "{}");
      if (!from) throw new Error("from is required");
      const reply = await handle({ channel: "imessage", address: from, text, replyTo, reaction });
      if (reply) console.log(`[dry-run] ← reply to ${from}: ${reply}`);
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ reply }));
    } catch (e) {
      res.writeHead(400).end(e instanceof Error ? e.message : String(e));
    }
  });
  server.listen(port, () => console.log(`dev inbound simulator on http://localhost:${port}/dev/inbound`));
  return server;
}
