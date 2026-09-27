-- Concurrent writes (migration 0009): the parts one transaction can check. Run with:
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/concurrent_writes.sql
-- A transaction can't race itself, so the races are replayed with two sessions in
-- concurrent_writes_race.sh. This file checks that each writer takes the per-number lock (keyed the
-- same way whatever format the number came in), that a repeated "Verify 123456" stays quiet, and that
-- the rewritten link_friends and merge_profile_into still behave as before.
begin;
\set QUIET on
-- Verifying by text is tested first, so the demo auto-verify trigger (migration 0007) is off until the end.
do $$ begin
  if exists (select 1 from pg_trigger where tgname = 'demo_auto_verify_phone') then
    alter table public.phone_verifications disable trigger demo_auto_verify_phone;
  end if;
end $$;
create temp table ids (name text primary key, auth uuid, profile uuid);
grant all on ids to authenticated, service_role;
create temp table r (name text primary key, j jsonb);
grant all on r to authenticated, service_role;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-0000-0000-0000000000c1', 'race-c-t1@example.com', '{"full_name":"race-c-T1"}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000c2', 'race-c-t2@example.com', '{"full_name":"race-c-T2"}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000c3', 'race-c-t3@example.com', '{"full_name":"race-c-T3"}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000c4', 'race-c-t4@example.com', '{"full_name":"race-c-T4"}', 'authenticated', 'authenticated');
insert into ids select n, u, (select id from public.profiles where auth_user_id = u)
from (values ('t1', '00000000-0000-0000-0000-0000000000c1'::uuid), ('t2', '00000000-0000-0000-0000-0000000000c2'::uuid),
             ('t3', '00000000-0000-0000-0000-0000000000c3'::uuid), ('t4', '00000000-0000-0000-0000-0000000000c4'::uuid)) v(n, u);

create function pg_temp.as_user(n text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', (select auth from ids where name = n), 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.as_agent() returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end $$;
create function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAILED: %', msg; end if;
  raise notice 'ok: %', msg;
end $$;
-- Does this transaction hold the advisory lock migration 0009 takes for key k (see public.xact_lock)?
create function pg_temp.holds_lock(k text) returns boolean language sql as $$
  select exists (
    select 1 from pg_catalog.pg_locks l, (select pg_catalog.hashtextextended(k, 0) as h) x
    where l.locktype = 'advisory' and l.pid = pg_catalog.pg_backend_pid() and l.granted and l.objsubid = 1
      and l.classid = ((x.h >> 32) & 4294967295)::oid and l.objid = (x.h & 4294967295)::oid)
$$;

-- ── Every writer keyed by a number takes the same lock on it ─────────────────────────────────

select pg_temp.as_user('t1');
insert into r select 'invite', public.invite_friend('(555) 020-0101', 'race-c-G');
select pg_temp.check(pg_temp.holds_lock('address:+15550200101'), 'invite_friend locks the number it looks up');
select pg_temp.check(pg_temp.holds_lock('invitee:' || (select j->>'friend_id' from r where name = 'invite')),
  'invite_friend locks the invitee before its 30-day check');

select pg_temp.as_agent();
select public.agent_handle_inbound('imessage', '555-020-0102', 'hi');
select pg_temp.check(pg_temp.holds_lock('address:+15550200102'), 'agent_handle_inbound locks the sender''s number');
select public.complete_phone_verification('imessage', '1 555 020 0103', '000000');
select pg_temp.check(pg_temp.holds_lock('address:+15550200103'), 'complete_phone_verification locks the sender''s number');

select pg_temp.as_user('t2');
select public.start_phone_verification('+1 (555) 020-0104');
select pg_temp.check(pg_temp.holds_lock('address:+15550200104'), 'start_phone_verification locks the number before writing the row');

-- ── A repeated "Verify 123456" is ignored, not answered with an error ────────────────────────

select pg_temp.as_user('t4');
insert into r select 'start', public.start_phone_verification('5550200106');
select pg_temp.as_agent();
select pg_temp.check((public.agent_handle_inbound('imessage', '+15550200106', 'Verify ' || (select j->>'code' from r where name = 'start')))->>'action'
  = 'verified', 'first Verify text verifies');
insert into r select 'again', public.agent_handle_inbound('imessage', '+15550200106', 'Verify ' || (select j->>'code' from r where name = 'start'));
select pg_temp.check((select j->>'action' from r where name = 'again') = 'ignored', 'the same text again is ignored');
select pg_temp.check((select j->>'user_id' from r where name = 'again') = (select profile::text from ids where name = 't4'),
  'ignored reply carries the user');
select pg_temp.check((public.agent_handle_inbound('imessage', '+15550200107', 'Verify ' || (select j->>'code' from r where name = 'start')))->>'action'
  = 'code_unknown', 'the used code from a different phone is still unknown');
select pg_temp.check((public.agent_handle_inbound('imessage', '+15550200106', 'Verify 000000'))->>'action' = 'code_unknown',
  'a wrong code is still unknown');

-- ── link_friends: same answers as before ─────────────────────────────────────────────────────

reset role;
create temp table g as select i, gen_random_uuid() as id from generate_series(1, 30) i;
insert into public.profiles (id, display_name) select id, 'race-c-g' || i from g;
create function pg_temp.g(n int) returns uuid language sql as $$ select id from g where i = n $$;
create function pg_temp.me(n text) returns uuid language sql as $$ select profile from ids where name = n $$;

select pg_temp.check(public.link_friends(pg_temp.me('t3'), pg_temp.g(1), false) = 'pending', 'first link is pending');
select pg_temp.check(public.link_friends(pg_temp.me('t3'), pg_temp.g(1), false) = 'pending', 'asking again stays pending');
select pg_temp.check(public.link_friends(pg_temp.g(1), pg_temp.me('t3'), false) = 'accepted', 'the other side asking accepts');
select pg_temp.check(public.link_friends(pg_temp.me('t3'), pg_temp.g(1), true) = 'already_friends', 'then they are already friends');
select pg_temp.check(public.link_friends(pg_temp.me('t3'), pg_temp.g(2), true) = 'accepted', 'accepting a link befriends at once');
select pg_temp.check((select requested_by from public.friendships
  where user_a = least(pg_temp.me('t3'), pg_temp.g(2)) and user_b = greatest(pg_temp.me('t3'), pg_temp.g(2))) = pg_temp.me('t3'),
  'requested_by is the caller');
insert into public.friendships (user_a, user_b, status, requested_by, blocked_by)
  values (least(pg_temp.me('t3'), pg_temp.g(3)), greatest(pg_temp.me('t3'), pg_temp.g(3)), 'blocked', pg_temp.g(3), pg_temp.g(3));
do $$ begin
  perform public.link_friends(pg_temp.me('t3'), pg_temp.g(3), true);
  raise exception 'linking a blocked pair should fail';
exception when others then
  if sqlerrm not like '%can''t add%' then raise; end if;
end $$;
select pg_temp.check(true, 'blocked pair is refused');
do $$ begin
  perform public.link_friends(pg_temp.me('t3'), pg_temp.me('t3'), false);
  raise exception 'linking yourself should fail';
exception when others then
  if sqlerrm not like '%own number%' then raise; end if;
end $$;
select pg_temp.check(true, 'own number is refused');

-- Circle limit: t3 has 2 (g1, g2; the blocked g3 doesn't count). 23 more reach 25, the 26th is refused.
select pg_temp.check((select count(*) from generate_series(4, 26) i
  where public.link_friends(pg_temp.me('t3'), pg_temp.g(i), false) = 'pending') = 23, '23 more requests');
select pg_temp.check(public.circle_size(pg_temp.me('t3')) = 25, 'the 25th friend fits');
do $$ begin
  perform public.link_friends(pg_temp.me('t3'), pg_temp.g(27), false);
  raise exception 'a 26th friend should be refused';
exception when others then
  if sqlerrm not like '%circle is full%' then raise; end if;
end $$;
select pg_temp.check(not exists (select 1 from public.friendships where pg_temp.g(27) in (user_a, user_b)),
  'the refused 26th leaves no row');
select pg_temp.check(public.link_friends(pg_temp.me('t3'), pg_temp.g(1), false) = 'already_friends',
  'a full circle can still answer for existing friends');

-- ── merge_profile_into: clashes keep the stronger status ─────────────────────────────────────

-- The guest g30 merges into t1. g21..g25 are the other side of each case.
create function pg_temp.pair(a uuid, b uuid) returns public.friendships language sql as $$
  select * from public.friendships where user_a = least(a, b) and user_b = greatest(a, b)
$$;
insert into public.friendships (user_a, user_b, status, requested_by, blocked_by)
select least(x, y), greatest(x, y), s, rq, bl from (values
  (pg_temp.me('t1'), pg_temp.g(21), 'pending',  pg_temp.g(21),  null::uuid),  -- t1 has pending, guest has accepted
  (pg_temp.g(30),    pg_temp.g(21), 'accepted', pg_temp.g(21),  null),
  (pg_temp.me('t1'), pg_temp.g(22), 'accepted', pg_temp.me('t1'), null),     -- t1 has accepted, guest has pending
  (pg_temp.g(30),    pg_temp.g(22), 'pending',  pg_temp.g(30),  null),
  (pg_temp.g(30),    pg_temp.g(23), 'blocked',  pg_temp.g(23),  pg_temp.g(23)),  -- only the guest has it (blocked by them)
  (pg_temp.g(30),    pg_temp.g(24), 'pending',  pg_temp.g(30),  null),         -- only the guest has it (guest asked)
  (pg_temp.me('t1'), pg_temp.g(25), 'pending',  pg_temp.me('t1'), null),     -- t1 has pending, guest blocked them
  (pg_temp.g(30),    pg_temp.g(25), 'blocked',  pg_temp.g(30),  pg_temp.g(30)),
  (pg_temp.g(30),    pg_temp.me('t1'), 'pending', pg_temp.g(30), null)       -- guest and t1 themselves
) v(x, y, s, rq, bl);
select public.merge_profile_into(pg_temp.g(30), pg_temp.me('t1'));
select pg_temp.check((pg_temp.pair(pg_temp.me('t1'), pg_temp.g(21))).status = 'accepted', 'accepted beats pending');
select pg_temp.check((pg_temp.pair(pg_temp.me('t1'), pg_temp.g(21))).requested_by = pg_temp.g(21), 'requested_by kept');
select pg_temp.check((pg_temp.pair(pg_temp.me('t1'), pg_temp.g(22))).status = 'accepted', 'pending doesn''t downgrade accepted');
select pg_temp.check((pg_temp.pair(pg_temp.me('t1'), pg_temp.g(22))).requested_by = pg_temp.me('t1'), 'existing row untouched');
select pg_temp.check((pg_temp.pair(pg_temp.me('t1'), pg_temp.g(23))).status = 'blocked'
  and (pg_temp.pair(pg_temp.me('t1'), pg_temp.g(23))).blocked_by = pg_temp.g(23), 'their block carries over');
select pg_temp.check((pg_temp.pair(pg_temp.me('t1'), pg_temp.g(24))).status = 'pending'
  and (pg_temp.pair(pg_temp.me('t1'), pg_temp.g(24))).requested_by = pg_temp.me('t1'), 'guest''s request becomes the account''s');
select pg_temp.check((pg_temp.pair(pg_temp.me('t1'), pg_temp.g(25))).status = 'blocked'
  and (pg_temp.pair(pg_temp.me('t1'), pg_temp.g(25))).blocked_by = pg_temp.me('t1'), 'guest''s block becomes the account''s');
select pg_temp.check(not exists (select 1 from public.friendships where pg_temp.g(30) in (user_a, user_b)), 'nothing left on the guest');
select pg_temp.check(not exists (select 1 from public.profiles where id = pg_temp.g(30)), 'guest profile deleted');
select pg_temp.check(not exists (select 1 from public.friendships where user_a = user_b), 'no self-friendship');

-- ── Demo mode: the number verifies on entry, and a "Verify" text afterwards is ignored ───────

do $$ begin
  if exists (select 1 from pg_trigger where tgname = 'demo_auto_verify_phone') then
    alter table public.phone_verifications enable trigger demo_auto_verify_phone;
  end if;
end $$;
select pg_temp.as_user('t3');
insert into r select 'demo', public.start_phone_verification('555 020 0105');
select pg_temp.as_agent();
select pg_temp.check((public.agent_handle_inbound('imessage', '+15550200105', 'Verify ' || (select j->>'code' from r where name = 'demo')))->>'action'
  = case when exists (select 1 from pg_trigger where tgname = 'demo_auto_verify_phone') then 'ignored' else 'verified' end,
  'Verify text after the number is already verified is ignored (demo mode)');

\echo 'all concurrent-write checks passed'
rollback;
