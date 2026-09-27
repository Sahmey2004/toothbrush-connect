-- Text-to-verify: a number only becomes someone's iMessage address after they text "Verify 123456" from it.
-- That text proves the number, and it unlocks Photon, whose shared lines only message numbers that texted first.
-- Run with:
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/text_to_verify.sql
begin;
\set QUIET on
create temp table ids (name text primary key, auth uuid, profile uuid);
create temp table codes (name text primary key, code text);
grant all on ids, codes to authenticated, service_role;

-- Google accounts: an email and a name, no phone.
insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-0000-0000-0000000000b1', 'sahmey@example.com', '{"full_name":"Sahmey"}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b2', 'roy@example.com',    '{"full_name":"Roy"}',    'authenticated', 'authenticated');
insert into ids select n, u, (select id from public.profiles where auth_user_id = u)
from (values ('sahmey', '00000000-0000-0000-0000-0000000000b1'::uuid),
             ('roy',    '00000000-0000-0000-0000-0000000000b2'::uuid)) v(n, u);

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
-- True if `q` raises an error matching `pattern`.
create function pg_temp.raises(q text, pattern text) returns boolean language plpgsql as $$
begin
  execute q;
  return false;
exception when others then
  if sqlerrm !~* pattern then raise exception 'wrong error: %', sqlerrm; end if;
  return true;
end $$;

-- Saving a number without texting in is no longer possible.
select pg_temp.as_user('sahmey');
select pg_temp.check(pg_temp.raises($$select public.set_my_phone('(765) 301-8970')$$, 'text'),
  'set_my_phone refuses a number that was not texted in');
select pg_temp.check((public.get_me())->>'phone' is null, 'no phone yet');

-- Sahmey enters their number: a code, and no phone until they text it.
insert into codes select 'sahmey', (public.start_phone_verification('(765) 301-8970'))->>'code';
select pg_temp.check((public.get_me())#>>'{phone_verification,phone}' = '+17653018970', 'open verification for the number');
select pg_temp.check((public.get_me())#>>'{phone_verification,photon_user_id}' is null, 'no Photon line yet');
select pg_temp.check((public.get_me())->>'phone' is null, 'still no phone while waiting');

-- The agent registers the number with Photon and records the user's line, so the website can link to it.
select pg_temp.as_agent();
update public.phone_verifications set photon_user_id = 'pu_1', line_number = '+16282688640'
where user_id = (select profile from ids where name = 'sahmey') and phone = '+17653018970' and verified_at is null;
select pg_temp.as_user('sahmey');
select pg_temp.check((public.get_me())#>>'{phone_verification,line_number}' = '+16282688640', 'website sees the Photon line');

-- Wrong sender, or a code nobody has: nothing is linked.
select pg_temp.as_agent();
select pg_temp.check((public.agent_handle_inbound('imessage', '+17202548424', 'Verify ' || (select code from codes)))->>'action'
  = 'phone_mismatch', 'code texted from another number is refused');
select pg_temp.check((public.agent_handle_inbound('imessage', '+17653018970',
  'Verify ' || lpad(((((select code from codes)::int) + 1) % 1000000)::text, 6, '0')))->>'action'
  = 'code_unknown', 'unknown code is refused');

-- The right text from the right phone links it.
select pg_temp.check((public.agent_handle_inbound('imessage', '+17653018970', 'Verify ' || (select code from codes)))->>'action'
  = 'verified', 'texting the code verifies the number');
select pg_temp.as_user('sahmey');
select pg_temp.check((public.get_me())->>'phone' = '+17653018970', 'phone is linked after the text');
select pg_temp.check((public.get_me())->'phone_verification' = 'null'::jsonb, 'verification is closed');

-- Nobody else can claim that number.
select pg_temp.as_user('roy');
select pg_temp.check(pg_temp.raises($$select public.start_phone_verification('+17653018970')$$, 'another account'),
  'a verified number cannot be claimed by another account');

-- Removing a number also drops a verification that is still waiting.
select pg_temp.as_user('sahmey');
select public.start_phone_verification('+1 720 254 8424');
select public.set_my_phone('');
select pg_temp.check((public.get_me())->>'phone' is null, 'removing the number unlinks it');
select pg_temp.check((public.get_me())->'phone_verification' = 'null'::jsonb, 'removing the number drops the open verification');

\echo 'all checks passed'
rollback;
