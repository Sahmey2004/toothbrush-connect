// Drains the outbound_messages outbox. Invoked by pg_cron (public.invoke_agent_dispatch) with the
// service role key; each message is claimed once, so concurrent runs never double-send.
import { admin } from "../_shared/admin.ts";
import { type Channel, dryRun, sendMessage } from "../_shared/photon.ts";

Deno.serve(async () => {
  const { data: batch, error } = await admin.rpc("claim_outbound", { p_limit: 50 });
  if (error) {
    console.error("claim_outbound failed", error);
    return Response.json({ error: error.message }, { status: 500 });
  }

  let sent = 0;
  for (const m of batch ?? []) {
    const result = await sendMessage(m.channel as Channel, m.address, m.body, m.effect);
    await admin.rpc("complete_outbound", {
      p_id: m.id,
      p_ok: result.ok,
      p_provider_message_id: result.providerMessageId ?? null,
      p_error: result.error ?? null,
    });
    if (result.ok) sent++;
  }
  return Response.json({ claimed: batch?.length ?? 0, sent, dryRun });
});
