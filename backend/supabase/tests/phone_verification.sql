-- Phone verification by iMessage, and merging guest profiles into Google accounts. Run with:
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/phone_verification.sql
-- Replays what happened on the hosted project: an update sent to a phone invite never reached the
-- friend's real (Google) account, because the two profiles were never linked.
begin;
\set QUIET on
-- This file tests verifying by text, so the demo auto-verify trigger (migration 0007) is off here.
alter table public.phone_verifications disable trigger demo_auto_verify_phone;
create temp table ids (name text primary key, auth uuid, profile uuid);
grant all on ids to authenticated;

-- Google accounts: an email and a name, no phone.
insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'sahmey@example.com',  '{"full_name":"Sahmey"}',  'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a2', 'hwaejin@example.com', '{"full_name":"Hwaejin"}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a3', 'roy@example.com',     '{"full_name":"Roy"}',     'authenticated', 'authenticated');
insert into ids select n, u, (select id from public.profiles where auth_user_id = u)
from (values ('sahmey', '00000000-0000-0000-0000-0000000000a1'::uuid),
             ('hwaejin', '00000000-0000-0000-0000-0000000000a2'::uuid),
             ('roy', '00000000-0000-0000-0000-0000000000a3'::uuid)) v(n, u);

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
create temp table codes (name text primary key, code text);
grant all on codes to authenticated, service_role;

select pg_temp.as_user('sahmey');
select public.complete_onboarding('Sahmey', 'America/Chicago', '{morning,night}');
select public.invite_friend('+1 555 763 0903', 'Hwaejin');   -- guest for Hwaejin's number
select public.invite_friend('+1 555 765 0000', 'Sahmey');    -- Sahmey invited their own number
select public.invite_friend('roy@example.com');              -- Boy's email invite

-- The guest accepts by text, then Sahmey sends it an update.
select pg_temp.as_agent();
select pg_temp.check((public.agent_handle_inbound('imessage', '+15557630903', 'YES'))->>'action' = 'joined', 'guest accepts by texting YES');
select pg_temp.as_user('sahmey');
select public.start_session();
select public.post_check_in('fun', 'today', 'got promoted!!');
select public.set_check_in_audience((select id from public.check_ins limit 1), 'custom', null,
  array[(select friend_id from public.get_circle() where display_name = 'Hwaejin')]);

-- The real Hwaejin can't see any of it yet.
select pg_temp.as_user('hwaejin');
select public.complete_onboarding('Hwaejin', 'UTC', '{night}');
select pg_temp.check((select count(*) from public.get_feed()) = 0, 'before verifying: real account sees no update');
select pg_temp.check((select count(*) from public.get_circle()) = 0, 'before verifying: real account has no friends');
select pg_temp.check((public.get_me())->>'phone' is null, 'google account starts without a phone');

-- Hwaejin verifies the number.
insert into codes select 'hwaejin', (public.start_phone_verification('(555) 763-0903'))->>'code';
select pg_temp.check((public.get_me())->'phone_verification'->>'phone' = '+15557630903', 'open verification is reported');
select pg_temp.check(length((select code from codes where name = 'hwaejin')) = 6, 'six-digit code');

select pg_temp.as_agent();
select pg_temp.check((public.agent_handle_inbound('imessage', '+15550009999',
  'Verify ' || (select code from codes where name = 'hwaejin')))->>'action' = 'phone_mismatch',
  'code texted from a different phone is refused');
select pg_temp.check((public.agent_handle_inbound('imessage', '+15557630903', 'Verify 000000'))->>'action' in ('code_unknown'),
  'wrong code is refused');
select pg_temp.check(exists (select 1 from public.profiles where display_name = 'Hwaejin' and auth_user_id is null),
  'guest still exists after failed attempts');

create temp table result as
  select public.agent_handle_inbound('imessage', '+15557630903',
    'verify ' || (select code from codes where name = 'hwaejin') || ' please') as r;
grant all on result to authenticated;
select pg_temp.check((select r->>'action' from result) = 'verified', 'code from the right phone verifies');
select pg_temp.check((select r->'names' from result) ? 'Sahmey', 'reply names the friends that carried over');
select pg_temp.check(not exists (select 1 from public.profiles where display_name = 'Hwaejin' and auth_user_id is null),
  'guest profile merged away');

select pg_temp.as_user('hwaejin');
select pg_temp.check((public.get_me())->>'phone' = '+15557630903', 'phone now on the real account');
select pg_temp.check((public.get_me())->'phone_verification' = 'null'::jsonb, 'no open verification after success');
select pg_temp.check((select friendship_status from public.get_circle() where display_name = 'Sahmey') = 'accepted',
  'friendship carried over as accepted');
select pg_temp.check((select text from public.get_feed()) = 'got promoted!!', 'the update Sahmey sent now shows for Hwaejin');

-- Sahmey verifies their own number: the self-invite guest merges without a self-friendship.
select pg_temp.as_user('sahmey');
insert into codes select 'sahmey', (public.start_phone_verification('5557650000'))->>'code';
select pg_temp.as_agent();
select pg_temp.check((public.agent_handle_inbound('imessage', '+15557650000',
  'Verify ' || (select code from codes where name = 'sahmey')))->>'action' = 'verified', 'own number verifies');
select pg_temp.check(not exists (select 1 from public.friendships where user_a = user_b), 'no self-friendship');
select pg_temp.as_user('sahmey');
select pg_temp.check((select count(*) from public.get_circle() where friendship_status = 'accepted') = 1, 'still friends with Hwaejin');
select pg_temp.check((select count(*) from public.get_circle() where display_name = 'Roy' and friendship_status = 'pending') = 1,
  'email invite to Roy is pending');

-- Nobody else can claim a verified number.
select pg_temp.as_user('roy');
select public.complete_onboarding('Roy', 'UTC', '{night}');
do $$ begin
  perform public.start_phone_verification('+15557630903');
  raise exception 'claiming a taken number should fail';
exception when others then
  if sqlerrm not like '%already linked%' then raise; end if;
end $$;
select pg_temp.check(true, 'taken number cannot be claimed');

-- Future updates reach Hwaejin by iMessage now that the phone is linked.
select pg_temp.as_user('sahmey');
select public.end_session((select id from public.brush_sessions where status = 'active'));
select public.post_check_in('stressful', 'today', 'moving apartments');
select public.set_check_in_audience((select id from public.check_ins where status = 'held'), 'everyone');
select pg_temp.as_agent();
select pg_temp.check((select count(*) from public.outbound_messages where kind = 'check_in' and address = '+15557630903'
  and body like '[😣 STRESSFUL · today] Sahmey%') = 1, 'next update is queued for Hwaejin''s iMessage');

-- A website user can't call the agent-only functions.
select pg_temp.as_user('roy');
do $$ begin
  perform public.complete_phone_verification('imessage', '+15550000000', '123456');
  raise exception 'website user should not verify directly';
exception when insufficient_privilege then null;
end $$;
select pg_temp.check(true, 'complete_phone_verification is agent-only');

\echo 'all phone verification checks passed'
rollback;
