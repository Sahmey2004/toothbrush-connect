-- DEMO (migration 0007): a number typed on the website is verified at once, without texting a code. Run with:
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/demo_auto_verify.sql
begin;
\set QUIET on
create temp table ids (name text primary key, auth uuid);
grant all on ids to authenticated;

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-0000-0000-0000000000b1', 'sahmey@example.com',  '{"full_name":"Sahmey"}',  'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b2', 'hwaejin@example.com', '{"full_name":"Hwaejin"}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b3', 'roy@example.com',     '{"full_name":"Roy"}',     'authenticated', 'authenticated');
insert into ids values
  ('sahmey',  '00000000-0000-0000-0000-0000000000b1'),
  ('hwaejin', '00000000-0000-0000-0000-0000000000b2'),
  ('roy',     '00000000-0000-0000-0000-0000000000b3');

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

-- Sahmey invites Hwaejin's number, which makes a guest profile; the guest accepts by text.
select pg_temp.as_user('sahmey');
select public.complete_onboarding('Sahmey', 'America/Chicago', '{morning,night}');
select public.invite_friend('+1 555 763 0903', 'Hwaejin');
select pg_temp.as_agent();
select pg_temp.check((public.agent_handle_inbound('imessage', '+15557630903', 'YES'))->>'action' = 'joined', 'guest accepts by texting YES');

-- Hwaejin signs in with Google and types the number: connected at once.
select pg_temp.as_user('hwaejin');
select public.complete_onboarding('Hwaejin', 'America/Chicago', '{night}');
select public.start_phone_verification('(555) 763-0903');
select pg_temp.check((public.get_me())->>'phone' = '+15557630903', 'number is verified as soon as it is entered');
select pg_temp.check((public.get_me())->'phone_verification' = 'null'::jsonb, 'nothing waits for a text');
select pg_temp.check((select friendship_status from public.get_circle() where display_name = 'Sahmey') = 'accepted',
  'guest profile merged in: friendship carried over');
select pg_temp.as_agent();
select pg_temp.check((select verified_at is not null from public.channel_identities where address = '+15557630903'),
  'the agent sees a verified number (Photon Users sync and welcome text)');

-- Hwaejin's number gets Sahmey's next update.
select pg_temp.as_user('sahmey');
select public.start_session();
select public.post_check_in('fun', 'today', 'got promoted!!');
select public.set_check_in_audience((select id from public.check_ins where status = 'held'), 'everyone');
select pg_temp.as_agent();
select pg_temp.check((select count(*) from public.outbound_messages where kind = 'check_in' and address = '+15557630903') = 1,
  'update is queued for the auto-verified number');

-- Changing to another number verifies that one instead.
select pg_temp.as_user('hwaejin');
select public.start_phone_verification('+1 555 763 0904');
select pg_temp.check((public.get_me())->>'phone' = '+15557630904', 'a new number replaces the old one at once');

-- A number verified on one account still can't be taken by another.
select pg_temp.as_user('roy');
select public.complete_onboarding('Roy', 'UTC', '{night}');
do $$ begin
  perform public.start_phone_verification('+15557630904');
  raise exception 'claiming a taken number should fail';
exception when others then
  if sqlerrm not like '%already linked%' then raise; end if;
end $$;
select pg_temp.check(true, 'taken number cannot be claimed');

-- The trigger's function is internal.
do $$ begin
  perform public.demo_auto_verify_phone();
  raise exception 'website user should not call the trigger function';
exception when insufficient_privilege or feature_not_supported then null;
end $$;
select pg_temp.check(true, 'trigger function is not callable from the website');

\echo 'all demo auto-verify checks passed'
rollback;
