-- Smoke test for the core loop and FR-R8 authorization. Run with:
--   psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" -v ON_ERROR_STOP=1 -f supabase/tests/core_flow.sql
begin;
\set QUIET on
create temp table ids (name text primary key, auth uuid, profile uuid);
grant all on ids to authenticated;

-- Three people sign in by phone.
insert into auth.users (id, phone, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', '15550000001', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', '15550000002', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000c', '15550000003', 'authenticated', 'authenticated');
insert into ids select n, u, (select id from public.profiles where auth_user_id = u)
from (values ('priya', '00000000-0000-0000-0000-00000000000a'::uuid),
             ('sam',   '00000000-0000-0000-0000-00000000000b'::uuid),
             ('aisha', '00000000-0000-0000-0000-00000000000c'::uuid)) v(n, u);

create function pg_temp.as_user(n text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', (select auth from ids where name = n), 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin
  if not ok then raise exception 'FAILED: %', msg; end if;
  raise notice 'ok: %', msg;
end $$;

select pg_temp.as_user('priya');
select public.complete_onboarding('Priya', 'America/Chicago', '{morning,night}');
select pg_temp.check((public.invite_friend('(555) 000-0002', 'Sam'))->>'status' = 'pending', 'invite sam is pending');
select pg_temp.check((public.invite_friend('+15550000003', 'Aisha'))->>'status' = 'pending', 'invite aisha is pending');
select pg_temp.check((public.invite_friend('+15559999999', 'Jess'))->>'texted' = 'true', 'new number gets a text invite');

select pg_temp.as_user('sam');
select public.complete_onboarding('Sam', 'UTC', '{night}');
select pg_temp.check((select count(*) from public.get_circle() where friendship_status = 'pending' and not requested_by_me) = 1, 'sam sees request');
select public.respond_to_friend((select profile from ids where name = 'priya'), true);

select pg_temp.as_user('aisha');
select public.complete_onboarding('Aisha', 'UTC', '{night}');
select public.respond_to_friend((select profile from ids where name = 'priya'), true);

-- Priya makes a list containing only Sam, brushes and posts to it.
select pg_temp.as_user('priya');
insert into public.friend_lists (name) values ('Close 3');
select pg_temp.check((select letter from public.friend_lists where name = 'Close 3') = 'A', 'first list gets letter A');
insert into public.friend_list_members (list_id, friend_id)
  select id, (select profile from ids where name = 'sam') from public.friend_lists where name = 'Close 3';
select public.start_session();
select pg_temp.check((select count(*) from public.brush_sessions where status = 'active') = 1, 'session started');
select public.post_check_in('stressful', 'today', '  moving apartments send help  ');
select pg_temp.check((select audience_type from public.check_ins limit 1) = 'everyone', 'default audience is everyone');
-- Second reply while held replaces the first (FR-C6).
select public.post_check_in('fun', 'this_week', 'got promoted!!');
select pg_temp.check((select count(*) from public.check_ins) = 1, 'second reply replaces held check-in');

-- Nothing delivered during the hold.
select pg_temp.as_user('sam');
select pg_temp.check((select count(*) from public.get_feed()) = 0, 'sam sees nothing during hold');
select pg_temp.check((select count(*) from public.check_ins) = 0, 'held check-in invisible to sam');
select pg_temp.check((select count(*) from public.brush_sessions) = 1, 'sam sees priya brushing');

-- Priya picks the list during the hold, which sends now.
select pg_temp.as_user('priya');
select public.set_check_in_audience((select id from public.check_ins limit 1), 'list',
  (select id from public.friend_lists where name = 'Close 3'));
select pg_temp.check((select status from public.check_ins limit 1) = 'delivered', 'audience pick delivers immediately');
select pg_temp.check((select count(*) from public.check_in_recipients) = 1, 'author sees 1 recipient');

select pg_temp.as_user('sam');
select pg_temp.check((select audience_label from public.get_feed()) = 'just_for_you', 'sam gets just-for-you label');
select pg_temp.check((select count(*) from public.check_in_recipients) = 1, 'sam sees only his own recipient row');
select public.send_reaction((select check_in_id from public.get_feed()), 'heart');

select pg_temp.as_user('aisha');
select pg_temp.check((select count(*) from public.get_feed()) = 0, 'aisha (outside audience) sees nothing');
select pg_temp.check((select count(*) from public.check_ins) = 0, 'aisha cannot read the check-in row');
select pg_temp.check((select latest_mood from public.get_circle() where display_name = 'Priya') is null, 'aisha circle hides priya mood');

do $$ begin
  perform public.undo_check_in((select id from public.check_ins limit 1));
  raise exception 'aisha undo should fail';
exception when others then
  if sqlerrm = 'aisha undo should fail' then raise; end if;
end $$;

-- Hold expiry path: Aisha posts, the hold is forced to expire, cron job delivers to everyone.
select public.start_session();
select public.post_check_in('boring', 'today', null);
reset role;
update public.check_ins set deliver_at = now() - interval '1 second' where status = 'held';
select public.run_due_jobs();
select pg_temp.as_user('priya');
select pg_temp.check((select audience_label from public.get_feed() where author_name = 'Aisha') = 'everyone', 'expired hold delivers to everyone');
select pg_temp.check((select count(*) from public.reactions where kind = 'heart') = 1, 'priya receives sam''s reaction');

-- Undo during hold is never delivered.
reset role;
update public.brush_sessions set status = 'completed';
select pg_temp.as_user('priya');
select public.start_session();
select public.post_check_in('just_okay');
select public.undo_check_in((select id from public.check_ins where status = 'held'));
reset role;
select public.run_due_jobs();
select pg_temp.check((select count(*) from public.check_ins where status = 'undone') = 1, 'undone stays undone');

-- Outbox: invite texts and check-in texts with catalog labels.
select pg_temp.check((select count(*) from public.outbound_messages where kind = 'invite') = 3, 'three invite texts queued');
select pg_temp.check(not exists (select 1 from public.outbound_messages where body !~ '^\[[^\]]+\] '), 'every agent message starts with a label');
select pg_temp.check((select body from public.outbound_messages where kind = 'check_in' and user_id = (select profile from ids where name='sam') limit 1)
  = '[💌 JUST FOR YOU · FUN] Priya: "got promoted!!"', 'just-for-you message body');

-- Blocking hides everything.
select pg_temp.as_user('sam');
select public.block_friend((select profile from ids where name = 'priya'));
select pg_temp.as_user('priya');
select pg_temp.check((select count(*) from public.get_circle() where display_name = 'Sam') = 0, 'blocked friend disappears from circle');
select pg_temp.check((select count(*) from public.profiles where display_name = 'Sam') = 0, 'blocked friend profile hidden');

-- Agent inbound: STOP opts out, guest YES joins.
reset role;
select pg_temp.check((public.agent_handle_inbound('imessage', '+15559999999', 'yes'))->>'action' = 'joined', 'guest YES joins circle');
select pg_temp.check((public.agent_handle_inbound('imessage', '+15559999999', 'STOP'))->>'action' = 'stopped', 'STOP opts out');
select pg_temp.check((select count(*) from public.claim_outbound(100) where address = '+15559999999') = 0, 'opted-out address gets nothing');

\echo 'all checks passed'
rollback;
