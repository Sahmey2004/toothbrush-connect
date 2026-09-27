-- Brushing reminders (migration 0016): 5 minutes before someone's morning or night brush time, the database queues
-- one iMessage (kind 'reminder'); the agent adds the /start link. Run with:
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/brush_reminders.sql
begin;
\set QUIET on
create temp table ids (name text primary key, auth uuid, profile uuid);
grant all on ids to authenticated;

-- Priya and Sam sign in by phone, so each has a verified iMessage number. Gia signs in with Google and has none.
insert into auth.users (id, phone, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000c1', '15550001001', null, 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000c2', '15550001002', null, 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000c3', null, 'gia@example.com', 'authenticated', 'authenticated');
insert into ids select n, u, (select id from public.profiles where auth_user_id = u)
from (values ('priya', '00000000-0000-0000-0000-0000000000c1'::uuid),
             ('sam',   '00000000-0000-0000-0000-0000000000c2'::uuid),
             ('gia',   '00000000-0000-0000-0000-0000000000c3'::uuid)) v(n, u);

create function pg_temp.as_user(n text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', (select auth from ids where name = n), 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAILED: %', msg; end if;
  raise notice 'ok: %', msg;
end $$;
-- True if `q` raises an error matching `pattern`.
create function pg_temp.raises(q text, pattern text) returns boolean language plpgsql as $$
begin
  execute q;
  return false;
exception when others then
  if sqlerrm !~* pattern then raise exception 'wrong error: %', sqlerrm; end if;
  return true;
end $$;
create function pg_temp.pid(n text) returns uuid language sql as $$ select profile from ids where name = n $$;
-- Reminder messages queued for someone, oldest first.
create function pg_temp.reminders(n text) returns setof public.outbound_messages language sql as $$
  select * from public.outbound_messages where kind = 'reminder' and user_id = pg_temp.pid(n) order by id
$$;
create function pg_temp.n_reminders(n text) returns bigint language sql as $$
  select count(*) from pg_temp.reminders(n)
$$;

-- The website saves reminder times the way Profile does: a direct user_settings update, with the browser's timezone.
select pg_temp.as_user('priya');
update public.user_settings set timezone = 'America/Chicago', morning_reminder = '07:30', night_reminder = '22:00'
where user_id = pg_temp.pid('priya');
select pg_temp.check((public.get_me())#>>'{settings,night_reminder}' = '22:00:00', 'Priya saved her reminder times');
select pg_temp.check(pg_temp.raises($$select public.enqueue_brush_reminders()$$, 'permission denied'),
  'the website cannot queue reminders itself');
select pg_temp.as_user('sam');
update public.user_settings set timezone = 'America/New_York', night_reminder = '23:30', preferred_channel = 'web'
where user_id = pg_temp.pid('sam');
select pg_temp.as_user('gia');
update public.user_settings set timezone = 'America/Chicago', night_reminder = '22:00'
where user_id = pg_temp.pid('gia');
reset role;

-- Edges: 6 minutes early, nothing. Exactly 5 minutes before, one reminder.
select public.enqueue_brush_reminders('2026-10-01 21:54 America/Chicago');
select pg_temp.check(pg_temp.n_reminders('priya') = 0, 'nothing 6 minutes before');
select public.enqueue_brush_reminders('2026-10-01 21:55 America/Chicago');
select pg_temp.check(pg_temp.n_reminders('priya') = 1, 'queued exactly 5 minutes before');
select pg_temp.check((select body from pg_temp.reminders('priya')) = '[🌙 BRUSH TIME] Your night brush is in 5 minutes.',
  'night reminder text');
select pg_temp.check((select channel = 'imessage' and address = '+15550001001' and status = 'pending' and send_after <= now()
  from pg_temp.reminders('priya')), 'to Priya''s verified iMessage number, due now');

-- Later runs the same evening add nothing.
select public.enqueue_brush_reminders('2026-10-01 21:57 America/Chicago');
select public.enqueue_brush_reminders('2026-10-01 21:59:59 America/Chicago');
select pg_temp.check(pg_temp.n_reminders('priya') = 1, 'one reminder per night');

-- Edges: once the brush time arrives, it's too late to remind.
select public.enqueue_brush_reminders('2026-10-02 22:00 America/Chicago');
select pg_temp.check(pg_temp.n_reminders('priya') = 1, 'no reminder once the brush time has arrived');
select pg_temp.check(not exists (select 1 from public.brush_reminders where user_id = pg_temp.pid('priya') and local_date = '2026-10-02' and slot = 'night'),
  'and nothing logged for it');

-- The morning one has its own text, and the next night comes again.
select public.enqueue_brush_reminders('2026-10-03 07:26 America/Chicago');
select pg_temp.check((select body from pg_temp.reminders('priya') order by id desc limit 1)
  = '[🌅 BRUSH TIME] Your morning brush is in 5 minutes.', 'morning reminder text');
select public.enqueue_brush_reminders('2026-10-03 21:58 America/Chicago');
select pg_temp.check(pg_temp.n_reminders('priya') = 3, 'a new reminder the next day');

-- Quiet hours (default 23:00–07:00) and "Only on this website" don't hold a reminder back.
select public.enqueue_brush_reminders('2026-10-01 23:27 America/New_York');
select pg_temp.check((select count(*) = 1 and bool_and(send_after <= now() and channel = 'imessage') from pg_temp.reminders('sam')),
  'sent during quiet hours, and to a website-only person');

-- No verified number: nothing queued or logged.
select public.enqueue_brush_reminders('2026-10-01 21:57 America/Chicago');
select pg_temp.check(pg_temp.n_reminders('gia') = 0, 'no reminder without a verified number');
select pg_temp.check(not exists (select 1 from public.brush_reminders where user_id = pg_temp.pid('gia')), 'nothing logged for Gia');

-- Brushing now: logged as handled, not texted.
insert into public.brush_sessions (user_id, status) values (pg_temp.pid('priya'), 'active');
select public.enqueue_brush_reminders('2026-10-04 07:27 America/Chicago');
select pg_temp.check(pg_temp.n_reminders('priya') = 3, 'no reminder while brushing');
select pg_temp.check((select not queued from public.brush_reminders where user_id = pg_temp.pid('priya') and slot = 'morning' and local_date = '2026-10-04'),
  'logged as skipped');
delete from public.brush_sessions where user_id = pg_temp.pid('priya');

-- Started 22 minutes ago: skipped. Started 42 minutes ago: reminded.
insert into public.brush_sessions (user_id, status, started_at, ends_at, ended_at) values
  (pg_temp.pid('priya'), 'completed', '2026-10-05 07:05 America/Chicago', '2026-10-05 07:07 America/Chicago', '2026-10-05 07:07 America/Chicago');
select public.enqueue_brush_reminders('2026-10-05 07:27 America/Chicago');
select pg_temp.check(pg_temp.n_reminders('priya') = 3, 'no reminder 22 minutes after a brush');
insert into public.brush_sessions (user_id, status, started_at, ends_at, ended_at) values
  (pg_temp.pid('priya'), 'completed', '2026-10-06 06:45 America/Chicago', '2026-10-06 06:47 America/Chicago', '2026-10-06 06:47 America/Chicago');
select public.enqueue_brush_reminders('2026-10-06 07:27 America/Chicago');
select pg_temp.check(pg_temp.n_reminders('priya') = 4, 'reminded 42 minutes after a brush');

-- A 00:02 brush is reminded at 23:59 the day before, logged for the brush's own date.
update public.user_settings set night_reminder = '00:02' where user_id = pg_temp.pid('priya');
select public.enqueue_brush_reminders('2026-10-07 23:59 America/Chicago');
select pg_temp.check(exists (select 1 from public.brush_reminders where user_id = pg_temp.pid('priya') and slot = 'night' and local_date = '2026-10-08' and queued),
  'a 00:02 brush is reminded at 23:59 the day before');
select pg_temp.check(pg_temp.n_reminders('priya') = 5, 'and texted');

-- DST: 2026-11-01 is fall back in Chicago. 07:30 CST is 13:30 UTC, so 12:27 UTC is an hour early and 13:27 UTC is right.
select public.enqueue_brush_reminders('2026-11-01 12:27+00');
select pg_temp.check(pg_temp.n_reminders('priya') = 5, 'DST: not an hour early');
select public.enqueue_brush_reminders('2026-11-01 13:27+00');
select pg_temp.check(pg_temp.n_reminders('priya') = 6, 'DST: at 07:27 local time');

-- STOP: nothing while opted out.
update public.channel_identities set opted_out_at = now() where user_id = pg_temp.pid('priya');
select public.enqueue_brush_reminders('2026-11-02 07:27 America/Chicago');
select pg_temp.check(pg_temp.n_reminders('priya') = 6, 'no reminder after STOP');
update public.channel_identities set opted_out_at = null where user_id = pg_temp.pid('priya');

-- run_due_jobs (the 5 s cron) queues reminders too. Sam's morning time (unused so far) is 3 minutes from the real clock.
update public.user_settings set morning_reminder = ((now() at time zone 'America/New_York') + interval '3 minutes')::time
where user_id = pg_temp.pid('sam');
select public.run_due_jobs();
select pg_temp.check(exists (select 1 from pg_temp.reminders('sam') where body like '%morning brush%'), 'run_due_jobs queues due reminders');

-- Expiry: a reminder the agent didn't send within 10 minutes is dropped, not sent late. A newer one still goes.
update public.outbound_messages set created_at = now() - interval '11 minutes'
where id = (select id from pg_temp.reminders('priya') limit 1);
update public.outbound_messages set created_at = now() - interval '1 minute'
where id = (select id from pg_temp.reminders('priya') offset 1 limit 1);
create temp table claimed as select * from public.claim_outbound(1000);
select pg_temp.check((select status = 'skipped' and error = 'expired' from pg_temp.reminders('priya') limit 1), 'an 11-minute-old reminder expires');
select pg_temp.check(not exists (select 1 from claimed where id = (select id from pg_temp.reminders('priya') limit 1)), 'and is not sent');
select pg_temp.check(exists (select 1 from claimed where id = (select id from pg_temp.reminders('priya') offset 1 limit 1)), 'a 1-minute-old reminder is sent');

-- Phone removed after reminders were switched on: the times stay, nothing is queued or logged.
select pg_temp.as_user('priya');
select public.set_my_phone('');
select pg_temp.check((public.get_me())#>>'{settings,morning_reminder}' = '07:30:00', 'times stay saved without a phone');
reset role;
select public.enqueue_brush_reminders('2026-11-03 07:27 America/Chicago');
select pg_temp.check(not exists (select 1 from public.brush_reminders where user_id = pg_temp.pid('priya') and local_date = '2026-11-03'),
  'phone removed: nothing logged or queued');

\echo 'all checks passed'
rollback;
