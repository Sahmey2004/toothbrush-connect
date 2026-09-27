-- Outbox claims when several agents drain outbound_messages at once (migration 0008). Run with:
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/outbox_claims.sql
-- One transaction can't run two agents side by side, so each claim_outbound call plays the next agent's
-- poll, and pg_temp.later() moves a message's clock back to stand in for time passing.
begin;
\set QUIET on
create temp table fx (name text primary key, id bigint);

-- One person with two numbers; the second has texted STOP.
with p as (insert into public.profiles (display_name) values ('Outbox Test') returning id)
insert into public.channel_identities (user_id, channel, address, verified_at, opted_out_at)
select p.id, 'imessage', a, now(), case when a = '+15550142002' then now() end
from p, unnest(array['+15550142001', '+15550142002']) a;

create function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAILED: %', msg; end if;
  raise notice 'ok: %', msg;
end $$;
create function pg_temp.queue(p_name text, p_kind text default 'reaction', p_address text default '+15550142001')
returns void language plpgsql as $$
begin
  with m as (
    insert into public.outbound_messages (user_id, channel, address, kind, body)
    select user_id, channel, address, p_kind, '[❤️ REACTION] test ' || p_name
    from public.channel_identities where channel = 'imessage' and address = p_address
    returning id
  )
  insert into fx select p_name, id from m;
end $$;
create function pg_temp.id(p_name text) returns bigint language sql as $$
  select id from fx where name = p_name
$$;
create function pg_temp.msg(p_name text) returns public.outbound_messages language sql as $$
  select * from public.outbound_messages where id = pg_temp.id(p_name)
$$;
-- One agent's poll: does its claim_outbound call return this message?
create function pg_temp.claims(p_name text, p_limit int default 1000) returns boolean language sql as $$
  select pg_temp.id(p_name) in (select id from public.claim_outbound(p_limit))
$$;
-- The test messages one poll returns, in the order the agent would send them.
create function pg_temp.claim_order() returns bigint[] language sql as $$
  select coalesce(array_agg(c.id order by c.ordinality), '{}')
  from public.claim_outbound(1000) with ordinality c join fx on fx.id = c.id
$$;
-- plpgsql so this file still runs (and fails on its checks) against the functions before 0008.
create function pg_temp.later(p_name text, p_by interval) returns void language plpgsql as $$
begin
  update public.outbound_messages
  set created_at = created_at - p_by, send_after = send_after - p_by,
      claimed_at = claimed_at - p_by
  where id = pg_temp.id(p_name);
end $$;

-- 1. Waiting in the queue doesn't make a claim stealable. Queued at 23:00, held by quiet hours until now.
select pg_temp.queue('quiet');
update public.outbound_messages set created_at = now() - interval '8 hours' where id = pg_temp.id('quiet');
select pg_temp.check(pg_temp.claims('quiet'), 'agent A claims a message held overnight by quiet hours');
select pg_temp.check(not pg_temp.claims('quiet'), 'agent B''s next poll leaves it to A');
select pg_temp.check((pg_temp.msg('quiet')).attempts = 1, 'one send, one attempt');

-- Same for a retry: queued 3 minutes ago, first send failed.
select pg_temp.queue('retry');
update public.outbound_messages set created_at = now() - interval '3 minutes' where id = pg_temp.id('retry');
select pg_temp.check(pg_temp.claims('retry'), 'first try claimed');
select public.complete_outbound(pg_temp.id('retry'), false, null, 'Photon 503');
select pg_temp.check((pg_temp.msg('retry')).status = 'pending' and (pg_temp.msg('retry')).send_after = now() + interval '30 seconds',
  'a failed send waits 30 s');
select pg_temp.check(not pg_temp.claims('retry'), 'not retried during the 30 s');
select pg_temp.later('retry', '31 seconds');
select pg_temp.check(pg_temp.claims('retry'), 'retried after 30 s');
select pg_temp.check(not pg_temp.claims('retry'), 'the retry is claimed once');

-- 2. A claim is a 10-minute lease: long enough for an agent to send the rest of its batch of 50.
select pg_temp.queue('slow');
select pg_temp.check(pg_temp.claims('slow'), 'A claims it');
select pg_temp.later('slow', '9 minutes');
select pg_temp.check(not pg_temp.claims('slow'), 'B leaves it alone 9 minutes in: A may still be working through its batch');
select pg_temp.later('slow', '2 minutes');
select pg_temp.check(pg_temp.claims('slow'), 'after 10 minutes with no result (A crashed), B takes it over');
select pg_temp.check((pg_temp.msg('slow')).attempts = 2, 'the lapsed claim counts as an attempt');
select pg_temp.check(not pg_temp.claims('slow'), 'B''s claim is a fresh lease');

-- 3. A last attempt that never reports back ends as failed instead of staying in 'sending' forever.
select pg_temp.queue('crash');
update public.outbound_messages set attempts = 2 where id = pg_temp.id('crash');  -- two sends already failed
select pg_temp.check(pg_temp.claims('crash'), 'third attempt claimed');
select pg_temp.later('crash', '11 minutes');
select pg_temp.check(not pg_temp.claims('crash'), 'no fourth attempt');
select pg_temp.check((pg_temp.msg('crash')).status = 'failed' and (pg_temp.msg('crash')).error is not null,
  'the lapsed third attempt is marked failed');

-- 4. Late reports. A's send hangs past its lease; B takes over and sends; then A's send errors out.
select pg_temp.queue('late');
select pg_temp.check(pg_temp.claims('late'), 'A claims it');
select pg_temp.later('late', '11 minutes');
select pg_temp.check(pg_temp.claims('late'), 'B takes over the lapsed claim');
select public.complete_outbound(pg_temp.id('late'), true, 'photon-B');
select public.complete_outbound(pg_temp.id('late'), false, null, 'Photon timed out');  -- A, late
select pg_temp.check((pg_temp.msg('late')).status = 'sent' and (pg_temp.msg('late')).provider_message_id = 'photon-B'
  and (pg_temp.msg('late')).sent_at is not null and (pg_temp.msg('late')).error is null,
  'a late failure doesn''t undo a sent message');
select pg_temp.later('late', '1 minute');
select pg_temp.check(not pg_temp.claims('late'), 'so it isn''t sent a third time');
select public.complete_outbound(pg_temp.id('late'), true, 'photon-A');  -- a repeated success report
select pg_temp.check((pg_temp.msg('late')).provider_message_id = 'photon-B',
  'a second success keeps the first provider id (tapbacks find the message by it)');

-- A late success still counts if nobody has resent the message yet.
select pg_temp.queue('lapsed');
select pg_temp.check(pg_temp.claims('lapsed'), 'A claims it');
select pg_temp.later('lapsed', '11 minutes');
select pg_temp.check(not pg_temp.claims('lapsed', 0), 'B''s batch is full, so B only releases the lapsed claim');
select pg_temp.check((pg_temp.msg('lapsed')).status = 'pending', 'released for a retry');
select public.complete_outbound(pg_temp.id('lapsed'), true, 'photon-A');  -- A, late
select pg_temp.check((pg_temp.msg('lapsed')).status = 'sent', 'A''s late success is recorded');
select pg_temp.check(not pg_temp.claims('lapsed'), 'so it isn''t sent again');

-- 5. The usual paths still work.
select pg_temp.queue('ok');
select pg_temp.check(pg_temp.claims('ok'), 'claimed');
select public.complete_outbound(pg_temp.id('ok'), true, 'photon-ok');
select pg_temp.check((pg_temp.msg('ok')).status = 'sent' and (pg_temp.msg('ok')).provider_message_id = 'photon-ok'
  and (pg_temp.msg('ok')).sent_at = now(), 'a success is recorded');

select pg_temp.queue('flaky');
select pg_temp.claims('flaky');
select public.complete_outbound(pg_temp.id('flaky'), false, null, 'try 1');
select pg_temp.later('flaky', '31 seconds');
select pg_temp.claims('flaky');
select public.complete_outbound(pg_temp.id('flaky'), false, null, 'try 2');
select pg_temp.later('flaky', '31 seconds');
select pg_temp.check(pg_temp.claims('flaky'), 'third try claimed');
select public.complete_outbound(pg_temp.id('flaky'), false, null, 'try 3');
select pg_temp.check((pg_temp.msg('flaky')).status = 'failed' and (pg_temp.msg('flaky')).attempts = 3
  and (pg_temp.msg('flaky')).error = 'try 3', 'three failures and it gives up');
select pg_temp.later('flaky', '1 minute');
select pg_temp.check(not pg_temp.claims('flaky'), 'a failed message isn''t claimed');

select pg_temp.queue('stopped', 'reaction', '+15550142002');
select pg_temp.queue('stop-reply', 'system', '+15550142002');
select pg_temp.check(not pg_temp.claims('stopped'), 'nothing goes to a number that texted STOP');
select pg_temp.check((pg_temp.msg('stopped')).status = 'skipped', 'its message is skipped');
select pg_temp.check((pg_temp.msg('stop-reply')).status = 'sending', 'system replies still go out');

-- 6. A batch comes back in queue order, so an agent sending it one at a time keeps a friend's texts in
--    order (an update before its ✏️ EDITED), even after a row was rewritten, e.g. by a profile merge.
select pg_temp.queue('update', 'check_in');
select pg_temp.queue('edit', 'edited');
update public.outbound_messages set user_id = user_id where id = pg_temp.id('update');
select pg_temp.check(pg_temp.claim_order() = array[pg_temp.id('update'), pg_temp.id('edit')], 'batch is in queue order');

-- 7. Still the agent's RPCs only, with the same signatures.
select pg_temp.check(has_function_privilege('service_role', 'public.claim_outbound(int)', 'execute')
  and has_function_privilege('service_role', 'public.complete_outbound(bigint, boolean, text, text)', 'execute'),
  'the agent can call both');
select pg_temp.check(not has_function_privilege('authenticated', 'public.claim_outbound(int)', 'execute')
  and not has_function_privilege('anon', 'public.complete_outbound(bigint, boolean, text, text)', 'execute'),
  'the website can''t');
select pg_temp.check((select proretset and prorettype = 'public.outbound_messages'::regtype
  from pg_proc where oid = 'public.claim_outbound(int)'::regprocedure), 'claim_outbound returns outbound_messages rows');

\echo 'all outbox claim checks passed'
rollback;
