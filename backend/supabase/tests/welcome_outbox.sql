-- The welcome text goes through the outbox (migration 0010): the database queues one per person and number
-- when the number is verified without the person texting us (phone sign-in, demo auto-verify). Run with:
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/welcome_outbox.sql
-- Phones are +155503xxxxx, names start with welcome-d-.
begin;
\set QUIET on
-- Verifying by text comes first, with the demo auto-verify trigger (0007) off. It's on from "Demo" on, and
-- made here if the demo has ended.
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'demo_auto_verify_phone') then
    create trigger demo_auto_verify_phone after insert or update on public.phone_verifications
      for each row when (new.verified_at is null) execute function public.demo_auto_verify_phone();
  end if;
end $$;
alter table public.phone_verifications disable trigger demo_auto_verify_phone;

create temp table ids (name text primary key, auth uuid, profile uuid);
grant all on ids to authenticated, service_role;
create temp table codes (name text primary key, code text);
grant all on codes to authenticated, service_role;

-- A Google account (an email, no phone), or with p_phone a phone sign-in. The sign-up trigger makes the profile.
create function pg_temp.sign_up(n text, p_phone text default null) returns void language plpgsql as $$
declare v_auth uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, phone, raw_user_meta_data, aud, role)
  values (v_auth, case when p_phone is null then 'welcome-d-' || n || '@example.com' end, p_phone,
          jsonb_build_object('full_name', 'welcome-d-' || n), 'authenticated', 'authenticated');
  insert into ids values (n, v_auth, (select id from public.profiles where auth_user_id = v_auth));
end $$;
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
create function pg_temp.me(n text) returns uuid language sql as $$ select profile from ids where name = n $$;
-- Welcome texts queued to a number (on any account), or for one account.
create function pg_temp.welcomes(p_address text) returns bigint language sql as $$
  select count(*) from public.outbound_messages where kind = 'welcome' and address = p_address
$$;
create function pg_temp.welcomes_of(n text) returns bigint language sql as $$
  select count(*) from public.outbound_messages where kind = 'welcome' and user_id = pg_temp.me(n)
$$;

select pg_temp.sign_up(n) from unnest(array['tex', 'dee', 'inv', 'gus', 'web', 'mia', 'ex', 'old']) n;

-- ── Texting us: ✅ CONNECTED is the greeting, so no welcome ─────────────────────────────────

select pg_temp.as_user('tex');
insert into codes select 'tex', (public.start_phone_verification('(555) 030-0001'))->>'code';
select pg_temp.as_agent();
select pg_temp.check((public.agent_handle_inbound('imessage', '+15550300001', 'Verify ' || (select code from codes where name = 'tex')))->>'action'
  = 'verified', 'Tex verifies by texting the code');
select pg_temp.check(pg_temp.welcomes('+15550300001') = 0, 'verifying by text queues no welcome');

select pg_temp.check((public.agent_handle_inbound('imessage', '+15550300002', 'hi'))->>'action' = 'help', 'a new number texts the line');
select pg_temp.check(pg_temp.welcomes('+15550300002') = 0, 'someone who texts first (a guest) gets no welcome');

-- ── Demo auto-verify: one welcome, due at once ──────────────────────────────────────────────

reset role;
alter table public.phone_verifications enable trigger demo_auto_verify_phone;
-- Dee is in her quiet hours right now. The welcome answers her own action, so it goes out anyway.
update public.user_settings set timezone = 'UTC',
  quiet_start = (now() at time zone 'UTC' - interval '1 hour')::time,
  quiet_end   = (now() at time zone 'UTC' + interval '6 hours')::time
where user_id = pg_temp.me('dee');

select pg_temp.as_user('dee');
select public.start_phone_verification('(555) 030-0003');
select pg_temp.as_agent();
select pg_temp.check(pg_temp.welcomes_of('dee') = 1, 'entering a number (demo) queues one welcome');
select pg_temp.check((select address = '+15550300003' and channel = 'imessage' and status = 'pending'
                             and body like '[ℹ️ POST ON THE WEB] You''re set up for Toothbrush Connect.%'
                      from public.outbound_messages where kind = 'welcome' and user_id = pg_temp.me('dee')),
  'to the number just verified, with the agent template''s label and text');
select pg_temp.check(public.next_send_time(pg_temp.me('dee')) > now()
  and (select send_after <= now() from public.outbound_messages where kind = 'welcome' and user_id = pg_temp.me('dee')),
  'due now, even in quiet hours');

-- The same number again: re-entered on the website, and then the "Verify" text on top.
select pg_temp.as_user('dee');
insert into codes select 'dee', (public.start_phone_verification('+15550300003'))->>'code';
select pg_temp.as_agent();
select pg_temp.check((public.agent_handle_inbound('imessage', '+15550300003', 'Verify ' || (select code from codes where name = 'dee')))->>'action'
  = 'ignored', 'a Verify text after the demo verified the number is ignored');
select pg_temp.check(pg_temp.welcomes_of('dee') = 1, 'verifying the same number twice still gives one welcome');
-- The index is what holds across agents and sessions.
reset role;
do $$ begin
  insert into public.outbound_messages (user_id, channel, address, kind, body)
  values (pg_temp.me('dee'), 'imessage', '+15550300003', 'welcome', '[ℹ️ POST ON THE WEB] again');
  raise exception 'FAILED: a second welcome to the same number should be refused';
exception when unique_violation then null;
end $$;
select pg_temp.check(true, 'the database refuses a second welcome to the same number');

-- A new number is a new thread: it gets its own welcome. Going back to the first number sends nothing.
select pg_temp.as_user('dee');
select public.start_phone_verification('+15550300005');
select public.start_phone_verification('+15550300003');
select pg_temp.as_agent();
select pg_temp.check(pg_temp.welcomes('+15550300005') = 1 and pg_temp.welcomes_of('dee') = 2,
  'a changed number is welcomed once, and switching back sends nothing');

-- Tex, who verified by text, re-enters the number on the website.
select pg_temp.as_user('tex');
select public.start_phone_verification('+15550300001');
select pg_temp.as_agent();
select pg_temp.check(pg_temp.welcomes('+15550300001') = 0, 're-entering a number already verified by text sends nothing');

-- Gus enters a number Inv invited: the guest merges in, and Gus is welcomed once.
select pg_temp.as_user('inv');
select public.invite_friend('+15550300004', 'welcome-d-guest4');
select public.invite_friend('+15550300008', 'welcome-d-guest8');
select pg_temp.as_user('gus');
select public.start_phone_verification('+15550300004');
select pg_temp.as_agent();
select pg_temp.check(not exists (select 1 from public.profiles where display_name = 'welcome-d-guest4'), 'the invited guest merged into Gus');
select pg_temp.check(pg_temp.welcomes_of('gus') = 1 and pg_temp.welcomes('+15550300004') = 1, 'Gus gets one welcome');
select pg_temp.check(exists (select 1 from public.outbound_messages where user_id = pg_temp.me('gus') and kind = 'invite'),
  'the guest''s invite text moved to Gus');

-- Someone who reads on the web only asked for no texts.
reset role;
update public.user_settings set preferred_channel = 'web' where user_id = pg_temp.me('web');
select pg_temp.as_user('web');
select public.start_phone_verification('+15550300006');
select pg_temp.as_agent();
select pg_temp.check((select verified_at is not null from public.channel_identities where address = '+15550300006'),
  'the web-only user''s number is verified');
select pg_temp.check(pg_temp.welcomes('+15550300006') = 0, 'a web-only user gets no welcome');

-- ── Phone sign-in ─────────────────────────────────────────────────────────────────────────

reset role;
select pg_temp.sign_up('pho', '15550300007');
select pg_temp.sign_up('pgu', '15550300008');  -- the number Inv invited
select pg_temp.sign_up('ptx', '15550300002');  -- the number that texted first
select pg_temp.as_agent();
select pg_temp.check(pg_temp.welcomes_of('pho') = 1 and pg_temp.welcomes('+15550300007') = 1, 'phone sign-in queues one welcome');
select pg_temp.check((select user_id from public.channel_identities where address = '+15550300008') = pg_temp.me('pgu')
  and pg_temp.welcomes_of('pgu') = 1, 'signing in as an invited number claims its guest and welcomes it');
select pg_temp.check((select user_id from public.channel_identities where address = '+15550300002') = pg_temp.me('ptx')
  and pg_temp.welcomes_of('ptx') = 0, 'signing in as a number that texted first sends no welcome');

-- ── Merging a guest that was welcomed on the same number ──────────────────────────────────
-- Mia was welcomed on X (+15550300009), then moved to another number. Ex took X and was welcomed on it, then
-- Ex's login was deleted (profiles.auth_user_id is set null), leaving a guest that holds X and its welcome.
-- Mia taking X back merges that guest into her: its welcome must not clash with hers.

select pg_temp.as_user('mia');
select public.start_phone_verification('+15550300009');
select public.start_phone_verification('+15550300010');
select pg_temp.as_user('ex');
select public.start_phone_verification('+15550300009');
reset role;
delete from auth.users where id = (select auth from ids where name = 'ex');
select pg_temp.check(pg_temp.welcomes('+15550300009') = 2, 'Mia and Ex were each welcomed on X');

select pg_temp.as_user('mia');
do $$ begin
  perform public.start_phone_verification('+15550300009');
exception when unique_violation then
  raise exception 'FAILED: merging a guest with its own welcome broke the unique index: %', sqlerrm;
end $$;
select pg_temp.as_agent();
select pg_temp.check(not exists (select 1 from public.profiles where id = pg_temp.me('ex')), 'the guest merged into Mia');
select pg_temp.check(pg_temp.welcomes('+15550300009') = 1
  and (select user_id from public.outbound_messages where kind = 'welcome' and address = '+15550300009') = pg_temp.me('mia'),
  'one welcome to X is left, on Mia, and she isn''t welcomed on it again');

-- ── Deploying: numbers verified before the migration get nothing ──────────────────────────
-- Old verified their number before the welcome moved to the outbox (the old agent welcomed them).

reset role;
insert into public.channel_identities (user_id, channel, address, verified_at)
values (pg_temp.me('old'), 'imessage', '+15550300011', now() - interval '30 days');
create temp table welcomes_before as select count(*) as n from public.outbound_messages where kind = 'welcome';
\ir ../migrations/20260926000010_welcome_via_outbox.sql
select pg_temp.check((select count(*) from public.outbound_messages where kind = 'welcome') = (select n from welcomes_before),
  'running the migration (again) queues nothing for numbers already verified');

select pg_temp.as_user('old');
select public.start_phone_verification('+15550300011');
select pg_temp.as_agent();
select pg_temp.check(pg_temp.welcomes('+15550300011') = 0, 'someone verified before the deploy who re-enters the number gets nothing');
select pg_temp.as_user('old');
select public.start_phone_verification('+15550300012');
select pg_temp.as_agent();
select pg_temp.check(pg_temp.welcomes('+15550300012') = 1, 'after the re-run, a new number is still welcomed');

\echo 'all welcome outbox checks passed'
rollback;
