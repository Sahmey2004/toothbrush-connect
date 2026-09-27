-- The welcome text ("You're set up for Toothbrush Connect") goes through the outbox, so each person gets it
-- once per number, even with several agents running or after a restart.
--
-- The agent used to send it itself from its Photon contact sync: a verified phone that the agent had just
-- added to Photon's Users got a welcome. That decision lived in each agent's memory, so after a restart a
-- number the phone-connect function had already added to Photon was never welcomed, a crash between adding
-- and sending lost the welcome, a failed send was never retried, and two agents (a laptop and a server)
-- could both welcome the same person.
--
-- Now the database queues it (kind 'welcome') in the transaction that verifies the number, on the paths
-- where the person hasn't texted us: phone sign-in (handle_new_auth_user) and demo auto-verify
-- (demo_auto_verify_phone, 0007). A number verified by texting "Verify 123456" is greeted with ✅ CONNECTED
-- instead, and people who text the line first started the thread themselves. The agent claims and retries
-- the welcome like any other message, and writes its text from its own template.
--
--   - One per account and number (outbound_one_welcome_per_number). A new number is a new thread, and the
--     first text on it should say what this is and how to opt out. Going back to a number that was already
--     welcomed sends nothing.
--   - Only when the number becomes verified. Re-entering a number that's already verified on the account
--     sends nothing, so nobody verified before this migration (the old agent welcomed them) is texted
--     again. This migration queues nothing itself.
--   - Not for web-only readers (preferred_channel 'web', as in enqueue_message): the text says updates will
--     arrive here, and they asked for none by text.
--   - Due at once, even in quiet hours: it answers the person's own action.
--
-- Function bodies are copied from their latest migration (0003, 0007, 0009); only the commented parts
-- change. Safe to run again.

-- Created only if missing: CREATE INDEX IF NOT EXISTS locks the table against writes until commit even
-- when the index is already there.
do $$ begin
  if to_regclass('public.outbound_one_welcome_per_number') is null then
    create unique index outbound_one_welcome_per_number on public.outbound_messages (user_id, address) where kind = 'welcome';
  end if;
end $$;

-- Queue the welcome to a number just verified on p_user's account. Null if none is due: the number isn't
-- verified on that account, it's opted out, the user reads on the web only, or it was welcomed already.
-- The agent sends templates/messages.ts renderWelcome (with the website link); this body is the fallback.
create or replace function public.enqueue_welcome(p_user uuid, p_channel text, p_address text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  insert into public.outbound_messages (user_id, channel, address, kind, body)  -- send_after: now
  select ci.user_id, ci.channel, ci.address, 'welcome',
         '[ℹ️ POST ON THE WEB] You''re set up for Toothbrush Connect. Friends'' updates will arrive here. Text STOP to opt out.'
  from public.channel_identities ci join public.user_settings s on s.user_id = ci.user_id
  where ci.user_id = p_user and ci.channel = p_channel and ci.address = p_address
    and ci.verified_at is not null and ci.opted_out_at is null and s.preferred_channel <> 'web'
  on conflict (user_id, address) where kind = 'welcome' do nothing
  returning id into v_id;
  return v_id;
end $$;

-- ── Phone sign-in (0003) ──────────────────────────────────────────────────────────────────────

create or replace function public.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_phone text := public.normalize_phone(new.phone);
  v_name text := left(trim(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', '')), 40);
  v_profile uuid;
  v_was_verified boolean;
begin
  if v_phone is not null then
    -- The number's lock before reading by it, as everywhere since 0009: a text from this number, or a website
    -- verification of it, commits first. So a guest it's creating is claimed below, and two accounts can't
    -- both be welcomed on the number.
    perform public.xact_lock('address:' || v_phone);
    select ci.user_id into v_profile
    from public.channel_identities ci join public.profiles p on p.id = ci.user_id
    where ci.address = v_phone and p.auth_user_id is null
    limit 1;
  end if;

  if v_profile is not null then
    update public.profiles set auth_user_id = new.id where id = v_profile;
  else
    insert into public.profiles (auth_user_id, display_name) values (new.id, v_name) returning id into v_profile;
  end if;
  insert into public.user_settings (user_id) values (v_profile) on conflict do nothing;

  if v_phone is not null then
    -- A guest that texted us has the number verified already: it started the thread itself.
    v_was_verified := exists (select 1 from public.channel_identities
                              where user_id = v_profile and address = v_phone and verified_at is not null);
    insert into public.channel_identities (user_id, channel, address, verified_at)
    values (v_profile, 'imessage', v_phone, now())
    on conflict (channel, address) do update set verified_at = now()
      where public.channel_identities.user_id = v_profile;
    -- Welcome it if it's now verified on this account (enqueue_welcome skips a number left with someone else).
    if not v_was_verified then
      perform public.enqueue_welcome(v_profile, 'imessage', v_phone);
    end if;
  end if;
  return new;
end $$;

-- ── Demo auto-verify (0007) ───────────────────────────────────────────────────────────────────

create or replace function public.demo_auto_verify_phone() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_phone text := public.normalize_phone(new.phone);
  v_was_verified boolean;
begin
  -- The number's lock before reading by it, as complete_phone_verification takes it (start_phone_verification
  -- already holds it). Re-entering a number already verified on the account doesn't verify it anew: no welcome.
  perform public.xact_lock('address:' || v_phone);
  v_was_verified := exists (select 1 from public.channel_identities
                            where user_id = new.user_id and address = v_phone and verified_at is not null);
  -- No text was involved, so nothing has greeted them: queue the welcome with the verification.
  if (public.complete_phone_verification('imessage', new.phone, new.code))->>'action' = 'verified' and not v_was_verified then
    perform public.enqueue_welcome(new.user_id, 'imessage', v_phone);
  end if;
  return null;
end $$;

-- ── Merging a guest into a real account (0009) ────────────────────────────────────────────────

create or replace function public.merge_profile_into(p_from uuid, p_into uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  f        public.friendships;
  v_other  uuid;
begin
  if p_from = p_into then
    return;
  end if;
  -- Lock the guest first. Anyone still adding a row that points at it (a friendship, a delivered update,
  -- a queued text) commits before we read, so the row is moved below instead of being cascade-deleted
  -- with the guest at the end. Anyone later waits, then finds the guest gone.
  perform 1 from public.profiles where id = p_from for update;

  -- Friendships: re-point to p_into. On a clash keep the stronger status (blocked > accepted > pending).
  for f in select * from public.friendships where p_from in (user_a, user_b) loop
    v_other := case when f.user_a = p_from then f.user_b else f.user_a end;
    delete from public.friendships where user_a = f.user_a and user_b = f.user_b;
    continue when v_other = p_into;  -- e.g. someone invited their own number

    -- An upsert, not select-then-insert: link_friends may be creating this pair right now.
    insert into public.friendships as x (user_a, user_b, status, requested_by, blocked_by, created_at)
    values (least(p_into, v_other), greatest(p_into, v_other), f.status,
            case when f.requested_by = p_from then p_into else f.requested_by end,
            case when f.blocked_by = p_from then p_into else f.blocked_by end,
            f.created_at)
    on conflict (user_a, user_b) do update
      set status = excluded.status, blocked_by = excluded.blocked_by
      where case excluded.status when 'blocked' then 3 when 'accepted' then 2 else 1 end
          > case x.status when 'blocked' then 3 when 'accepted' then 2 else 1 end;
  end loop;

  -- Other people's lists that contained the guest.
  update public.friend_list_members m set friend_id = p_into
  where m.friend_id = p_from
    and not exists (select 1 from public.friend_list_members x where x.list_id = m.list_id and x.friend_id = p_into)
    and exists (select 1 from public.friend_lists l where l.id = m.list_id and public.are_friends(l.owner_id, p_into));
  delete from public.friend_list_members where friend_id = p_from;

  -- Updates the guest received (never your own), and held custom audiences that named the guest.
  insert into public.check_in_recipients (check_in_id, recipient_id, audience_label, channel, delivered_at, seen_at)
  select r.check_in_id, p_into, r.audience_label, r.channel, r.delivered_at, r.seen_at
  from public.check_in_recipients r join public.check_ins c on c.id = r.check_in_id
  where r.recipient_id = p_from and c.user_id <> p_into
  on conflict do nothing;
  delete from public.check_in_recipients where recipient_id = p_from;
  update public.check_ins set friend_ids = array_replace(friend_ids, p_from, p_into) where p_from = any (friend_ids);
  update public.check_ins set user_id = p_into where user_id = p_from;

  update public.reactions set from_user = p_into where from_user = p_from;
  update public.reactions set to_user = p_into where to_user = p_from;
  update public.invites set inviter_id = p_into where inviter_id = p_from;

  -- Message history keeps the 30-day invite limit working.
  delete from public.outbound_messages o
  where o.user_id = p_from and o.kind = 'check_in'
    and exists (select 1 from public.outbound_messages x where x.user_id = p_into and x.kind = 'check_in' and x.check_in_id = o.check_in_id);
  -- One welcome per account and number (0010): a guest's welcome to a number the account was welcomed on
  -- too goes. (A guest only has one if it was an account whose login was deleted.)
  delete from public.outbound_messages o
  where o.user_id = p_from and o.kind = 'welcome'
    and exists (select 1 from public.outbound_messages x where x.user_id = p_into and x.kind = 'welcome' and x.address = o.address);
  update public.outbound_messages set user_id = p_into where user_id = p_from;

  update public.channel_identities set user_id = p_into where user_id = p_from;
  delete from public.profiles where id = p_from;  -- cascades settings, sessions, verification
end $$;

-- ── Grants ────────────────────────────────────────────────────────────────────────────────────

-- create or replace keeps the existing functions' grants; the new helper is internal.
revoke execute on function public.enqueue_welcome(uuid, text, text) from public, anon, authenticated;
