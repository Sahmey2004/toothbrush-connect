-- Brushing sessions and check-ins under concurrency (migration 0011): the parts one transaction can check.
-- Run with:
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/session_races.sql
-- A transaction can't race itself, so the races are replayed with two sessions in session_races.sh. This
-- file checks that the rewritten start_session, post_check_in, run_due_jobs and notify_presence still
-- behave as before one call at a time, keep their signatures and grants, and take the presence lock.
begin;
\set QUIET on
\o /dev/null
create temp table ids (name text primary key, auth uuid, profile uuid);
grant all on ids to authenticated;

-- t1 brushes; e2 is a friend who is brushing; e3 a friend who isn't (no quiet hours); e4 another friend
-- of e3; t5 brushes by text (gets a DONE).
insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-0000-0000-0000000000e1', 'race-e-t1@example.com', '{"full_name":"race-e-T1"}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000e2', 'race-e-t2@example.com', '{"full_name":"race-e-E2"}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000e3', 'race-e-t3@example.com', '{"full_name":"race-e-E3"}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000e4', 'race-e-t4@example.com', '{"full_name":"race-e-E4"}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000e5', 'race-e-t5@example.com', '{"full_name":"race-e-T5"}', 'authenticated', 'authenticated');
insert into ids select n, u, (select id from public.profiles where auth_user_id = u)
from (values ('t1', '00000000-0000-0000-0000-0000000000e1'::uuid), ('e2', '00000000-0000-0000-0000-0000000000e2'::uuid),
             ('e3', '00000000-0000-0000-0000-0000000000e3'::uuid), ('e4', '00000000-0000-0000-0000-0000000000e4'::uuid),
             ('t5', '00000000-0000-0000-0000-0000000000e5'::uuid)) v(n, u);

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
create function pg_temp.me(n text) returns uuid language sql as $$ select profile from ids where name = n $$;
-- Does this transaction hold the advisory lock public.xact_lock(k) takes? (as in concurrent_writes.sql)
create function pg_temp.holds_lock(k text) returns boolean language sql as $$
  select exists (
    select 1 from pg_catalog.pg_locks l, (select pg_catalog.hashtextextended(k, 0) as h) x
    where l.locktype = 'advisory' and l.pid = pg_catalog.pg_backend_pid() and l.granted and l.objsubid = 1
      and l.classid = ((x.h >> 32) & 4294967295)::oid and l.objid = (x.h & 4294967295)::oid)
$$;
create function pg_temp.texts(p_to text, p_kind text) returns bigint language sql as $$
  select count(*) from public.outbound_messages where user_id = pg_temp.me(p_to) and kind = p_kind
$$;

insert into public.channel_identities (user_id, channel, address, verified_at)
select pg_temp.me(n), 'imessage', phone, now()
from (values ('e2', '+15550400102'), ('e3', '+15550400103'), ('e4', '+15550400104'), ('t5', '+15550400105')) v(n, phone);
update public.user_settings set quiet_start = '00:00', quiet_end = '00:00' where user_id = pg_temp.me('e3');
insert into public.friendships (user_a, user_b, status, requested_by)
select least(pg_temp.me(a), pg_temp.me(b)), greatest(pg_temp.me(a), pg_temp.me(b)), 'accepted', pg_temp.me(a)
from (values ('t1', 'e2'), ('t1', 'e3'), ('e4', 'e3')) v(a, b);
insert into public.brush_sessions (user_id) values (pg_temp.me('e2'));

-- ── Signatures and grants are unchanged ──────────────────────────────────────────────────────

select pg_temp.check((select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') ' ||
                        pg_get_function_result(p.oid) || case when p.prosecdef then ' definer' else '' end ||
                        ' ' || array_to_string(p.proconfig, ','), E'\n' order by p.proname)
                      from pg_proc p
                      where p.pronamespace = 'public'::regnamespace
                        and p.proname in ('notify_presence', 'post_check_in', 'run_due_jobs', 'start_session'))
  = E'notify_presence(p_owner uuid) void definer search_path=""\n'
    'post_check_in(p_mood text, p_scope text, p_text text, p_audience_type text, p_list_id uuid, p_friend_ids uuid[]) check_ins definer search_path=""\n'
    'run_due_jobs() void definer search_path=""\n'
    'start_session(p_channel text) brush_sessions definer search_path=""',
  'same signatures, return types, security definer and search_path');
select pg_temp.check(has_function_privilege('authenticated', 'public.start_session(text)', 'execute')
  and has_function_privilege('authenticated', 'public.post_check_in(text, text, text, text, uuid, uuid[])', 'execute')
  and has_function_privilege('authenticated', 'public.run_due_jobs()', 'execute')
  and has_function_privilege('service_role', 'public.run_due_jobs()', 'execute')
  and not has_function_privilege('authenticated', 'public.notify_presence(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.start_session(text)', 'execute'),
  'grants kept');

-- ── start_session ────────────────────────────────────────────────────────────────────────────

select pg_temp.as_user('t1');
create temp table s as select * from public.start_session();
grant all on s to authenticated;
select pg_temp.check((select status from s) = 'active' and (select channel from s) = 'web', 'start_session starts a web session');
select pg_temp.check((public.start_session('imessage')).id = (select id from s), 'starting again returns the same session');
select pg_temp.check((select count(*) from public.brush_sessions where user_id = pg_temp.me('t1') and status = 'active') = 1,
  'still one active session');
reset role;
select pg_temp.check(pg_temp.texts('e2', 'presence') = 1, 'friends were told once, not again on the second start');

-- ── notify_presence ──────────────────────────────────────────────────────────────────────────

select pg_temp.check(pg_temp.texts('e3', 'presence_proactive') = 1, 'a friend who isn''t brushing gets a proactive text');
select pg_temp.check(pg_temp.holds_lock('presence:' || pg_temp.me('e3')),
  'notify_presence locks the friend before its one-a-day check');
select pg_temp.check(not pg_temp.holds_lock('presence:' || pg_temp.me('e2')),
  'no lock for a friend who is brushing (no daily limit there)');
select pg_temp.as_user('e4');
select public.start_session();
reset role;
select pg_temp.check(pg_temp.texts('e3', 'presence_proactive') = 1, 'still one proactive text a day');

-- ── A session that has run out ───────────────────────────────────────────────────────────────

update public.brush_sessions set started_at = now() - interval '3 minutes', ends_at = now() - interval '1 minute'
where id = (select id from s);
select pg_temp.as_user('t1');
select pg_temp.check((public.start_session()).id <> (select id from s), 'an expired session is replaced by a new one');
reset role;
select pg_temp.check((select status = 'completed' and ended_at = ends_at from public.brush_sessions where id = (select id from s)),
  'the expired one is completed at its end time');
select pg_temp.check(pg_temp.texts('e2', 'presence') = 2, 'the new session tells friends again');

select pg_temp.as_user('t1');
select public.end_session((select id from public.brush_sessions where user_id = pg_temp.me('t1') and status = 'active'));
select pg_temp.check((select count(*) from public.brush_sessions where user_id = pg_temp.me('t1') and status = 'active') = 0,
  'end_session ends it');
truncate s;
insert into s select * from public.start_session();
select pg_temp.check((select status from s) = 'active', 'and a new one can start after');

-- ── post_check_in ────────────────────────────────────────────────────────────────────────────

create temp table c as select * from public.post_check_in('stressful', 'today', '  first  ');
grant all on c to authenticated;
select pg_temp.check((select status = 'held' and session_id = (select id from s) and text = 'first' from c),
  'first post in a session is held in that session');
reset role;
update public.check_ins set deliver_at = deliver_at - interval '20 seconds' where id = (select id from c);
select pg_temp.as_user('t1');
select pg_temp.check((select id = (select id from c) and mood = 'fun' and deliver_at > now() + interval '20 seconds'
                      from public.post_check_in('fun', 'this_week', 'second')),
  'second post replaces it and restarts the 30-second hold');
select pg_temp.check((select count(*) from public.check_ins where session_id = (select id from s)) = 1, 'one check-in in the session');
select public.set_check_in_audience((select id from c), 'everyone');
select pg_temp.check((select status from public.check_ins where id = (select id from c)) = 'delivered',
  'set_check_in_audience still sends during the hold');
do $$ begin
  perform public.post_check_in('boring');
  raise exception 'a post after delivery should fail';
exception when others then
  if sqlerrm <> 'You already checked in this session. Edit your update instead.' then raise; end if;
end $$;
select pg_temp.check(true, 'a post after delivery is refused, same message');

-- Outside a session every post is its own update, as before.
select public.end_session((select id from s));
select public.post_check_in('fun', 'today', 'no session 1');
select public.post_check_in('boring', 'today', 'no session 2');
select pg_temp.check((select count(*) from public.check_ins where user_id = pg_temp.me('t1') and session_id is null and status = 'held') = 2,
  'posts without a session each make a check-in');

-- ── run_due_jobs ─────────────────────────────────────────────────────────────────────────────

-- One of t1's held posts is due, the other still in its hold; t5's text-channel session has run out.
reset role;
update public.check_ins set deliver_at = now() - interval '1 second' where user_id = pg_temp.me('t1') and text = 'no session 1';
insert into public.brush_sessions (user_id, channel, started_at, ends_at)
values (pg_temp.me('t5'), 'imessage', now() - interval '3 minutes', now() - interval '1 minute');
select public.run_due_jobs();
select pg_temp.check((select status from public.check_ins where user_id = pg_temp.me('t1') and text = 'no session 1') = 'delivered',
  'run_due_jobs delivers a due check-in');
select pg_temp.check((select status from public.check_ins where user_id = pg_temp.me('t1') and text = 'no session 2') = 'held',
  'and leaves one still in its hold');
select pg_temp.check((select status = 'completed' and ended_at = ends_at from public.brush_sessions where user_id = pg_temp.me('t5')),
  'run_due_jobs completes an expired session at its end time');
select pg_temp.check(pg_temp.texts('t5', 'done') = 1, 'with one DONE text');
select public.run_due_jobs();
select pg_temp.check(pg_temp.texts('t5', 'done') = 1, 'a second run adds no DONE');

\echo 'all session checks passed'
rollback;
