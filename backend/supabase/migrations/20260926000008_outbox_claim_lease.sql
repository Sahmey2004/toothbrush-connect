-- Outbox claims become leases, so each message is sent once even when several agents poll at the same time
-- (a laptop and a server, or the legacy agent-dispatch function).
--
-- claim_outbound used to give a 'sending' row to the next poll once the row was 2 minutes old, measured from
-- created_at. A message that had waited in the queue (quiet hours, a retry, an early invite) was already that
-- old when it was claimed, so another agent took it back right away and texted it a second time. Now a claim
-- records claimed_at and lasts 10 minutes. An agent claims up to 50 messages and sends them one at a time
-- (0.5–2 s through Photon, plus the Photon Users check and a check-in lookup), so the last message in a
-- batch waits about 2–3 minutes for its turn. 10 minutes leaves room for a slow Photon before another agent
-- may resend the end of the batch. The cost is that a crashed agent's messages wait up to 10 minutes for a
-- retry, which is better than texting someone twice.

alter table public.outbound_messages add column if not exists claimed_at timestamptz;  -- start of the latest claim
-- Every poll looks for lapsed claims.
create index if not exists outbound_sending on public.outbound_messages (claimed_at) where status = 'sending';

create or replace function public.claim_outbound(p_limit int default 50) returns setof public.outbound_messages
language plpgsql security definer set search_path = '' as $$
begin
  -- Each step skips rows another poll has locked, since that poll is already handling them. Otherwise two
  -- polls wait on each other's rows in no set order and can deadlock.
  update public.outbound_messages set status = 'skipped', error = 'opted out'
  where id in (
    select o.id from public.outbound_messages o
    join public.channel_identities ci on ci.channel = o.channel and ci.address = o.address
    where o.status = 'pending' and ci.opted_out_at is not null and o.kind <> 'system'
    for update of o skip locked
  );

  -- A lapsed claim means the agent crashed or hung. It counts as an attempt: retry, or give up after the
  -- third instead of leaving the message in 'sending' forever.
  update public.outbound_messages
  set status = case when attempts < 3 then 'pending' else 'failed' end,
      error = 'no send result within 10 minutes'
  where id in (
    select id from public.outbound_messages
    where status = 'sending' and claimed_at < now() - interval '10 minutes'
    for update skip locked
  );

  -- Return the batch in queue order: the agent sends in the order it receives them, so a friend's update
  -- goes out before its ✏️ EDITED.
  return query
  with claimed as (
    update public.outbound_messages set status = 'sending', attempts = attempts + 1, claimed_at = now()
    where id in (
      select id from public.outbound_messages
      where status = 'pending' and send_after <= now()
      order by id limit p_limit
      for update skip locked
    )
    returning *
  )
  select * from claimed order by id;
end $$;

-- A failure counts only while the message is still out for sending, so a late report from an agent whose
-- claim lapsed can't send a message again after another agent already delivered it. A success is always
-- recorded, once: the text reached the phone, and recording it stops a resend. This function can't tell
-- which agent is reporting (it has no claim token), so the lease must be much longer than any send.
create or replace function public.complete_outbound(p_id bigint, p_ok boolean, p_provider_message_id text default null, p_error text default null)
returns void
language sql security definer set search_path = '' as $$
  update public.outbound_messages
  set status = case when p_ok then 'sent' when attempts >= 3 then 'failed' else 'pending' end,
      sent_at = case when p_ok then now() end,
      send_after = case when p_ok then send_after else now() + interval '30 seconds' end,
      provider_message_id = p_provider_message_id,
      error = p_error
  where id = p_id and (status = 'sending' or p_ok and status <> 'sent')
$$;

-- Messages claimed before this migration have no claimed_at. Start their lease now instead of guessing when
-- it began, since a guess that is too early could send them twice. This runs after the new claim_outbound
-- is in place, so it also covers anything the old claim_outbound claimed in the meantime.
update public.outbound_messages set claimed_at = now() where status = 'sending' and claimed_at is null;
