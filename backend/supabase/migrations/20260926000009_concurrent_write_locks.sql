-- Concurrent writes: the website (as the signed-in user) and the agent (inbound texts) call these at the
-- same time, under READ COMMITTED. Several functions checked for a row and then inserted it; two callers
-- at once both saw nothing, and the second one either failed on a unique key or carried on with a
-- duplicate:
--   - two first texts from a new number made two guests, and the second text's STOP hit the one with no number
--   - two invites to a new number: the second failed on channel_identities (channel, address)
--   - two invites to the same person both passed the 30-day check and both texted
--   - two first links between a pair (A invites B while B accepts A's link, a double-click): primary key error
--   - merging a guest while someone invited it or it texted in: the friendship was cascade-deleted with the
--     guest, the invite errored, or STOP was lost
--   - a repeated "Verify 123456" waited for the first, found no open code and answered "code didn't work"
--
-- The fix: anything that reads and then writes by phone number first takes a transaction lock on the
-- normalized number (public.xact_lock('address:+15551234567')). Waiters start reading only after the
-- holder commits, so under READ COMMITTED they see its rows. A number's lock is always taken before its
-- verification row, and each transaction takes at most one number's lock, so these can't deadlock.
-- Friendships don't need a lock: link_friends and merge_profile_into insert with ON CONFLICT, which
-- waits for a concurrent insert of the same pair.
--
-- Function bodies are copied from their latest migration (0002, 0005, 0006); only the commented parts change.

-- Transaction-scoped advisory lock on a text key; released at commit or rollback. Keys:
--   'address:<E.164>'       a phone number: invites, inbound texts, verification
--   'invitee:<profile id>'  the 30-day invite-text check
create or replace function public.xact_lock(p_key text) returns void
language plpgsql set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_key, 0));
end $$;

-- ── Circle ────────────────────────────────────────────────────────────────────────────────────

-- Returns 'accepted' | 'pending' | 'already_friends'. Raises if blocked either way.
create or replace function public.link_friends(p_me uuid, p_other uuid, p_accept boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare f public.friendships;
begin
  if p_me = p_other then
    raise exception 'That''s your own number.';
  end if;
  -- Insert first: `select ... for update` has nothing to lock before the row exists, so two first links
  -- both inserted and one failed. A concurrent insert of the same pair now waits and then finds the row.
  loop
    insert into public.friendships (user_a, user_b, status, requested_by)
    values (least(p_me, p_other), greatest(p_me, p_other), case when p_accept then 'accepted' else 'pending' end, p_me)
    on conflict (user_a, user_b) do nothing
    returning * into f;
    if found then
      if public.circle_size(p_me) > 25 then  -- counts the row just added; raising removes it again
        raise exception 'Your circle is full (25 friends).';
      end if;
      return f.status;
    end if;

    select * into f from public.friendships where user_a = least(p_me, p_other) and user_b = greatest(p_me, p_other) for update;
    if found then
      if f.status = 'blocked' then
        raise exception 'You can''t add this person.';
      elsif f.status = 'accepted' then
        return 'already_friends';
      elsif p_accept or f.requested_by <> p_me then
        update public.friendships set status = 'accepted' where user_a = f.user_a and user_b = f.user_b;
        return 'accepted';
      end if;
      return 'pending';
    end if;
    -- Removed between the insert and the select: try again.
  end loop;
end $$;

-- FR-S1 / FR-S2 (0005): invite by email or phone.
create or replace function public.invite_friend(p_phone text, p_name text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me       uuid := public.require_me();
  v_input    text := trim(coalesce(p_phone, ''));
  v_phone    text;
  v_friend   uuid;
  v_status   text;
  v_texted   boolean := false;
  v_my_name  text;
begin
  if position('@' in v_input) > 0 then
    -- Email: must belong to someone who has signed in. No guest profile is created.
    select p.id into v_friend
    from auth.users u join public.profiles p on p.auth_user_id = u.id
    where lower(u.email) = lower(v_input)
    limit 1;
    if v_friend is null then
      raise exception 'Nobody has signed up with that email yet. Share an invite link instead.';
    end if;
  else
    v_phone := public.normalize_phone(v_input);
    if v_phone is null or length(v_phone) < 9 then
      raise exception 'Enter an email, or a phone number with area code.';
    end if;
    -- Lock the number before looking it up: two invites to a new number would both create a guest, and a
    -- guest being merged into an account (complete_phone_verification) must not be linked to meanwhile.
    perform public.xact_lock('address:' || v_phone);
    select user_id into v_friend from public.channel_identities where address = v_phone limit 1;
    if v_friend is null then
      insert into public.profiles (display_name) values (left(coalesce(trim(p_name), ''), 40)) returning id into v_friend;
      insert into public.user_settings (user_id) values (v_friend);
      insert into public.channel_identities (user_id, channel, address) values (v_friend, 'imessage', v_phone);
    end if;
  end if;

  v_status := public.link_friends(v_me, v_friend, false);

  -- Text an invite only if they have a messaging address (enqueue_message returns null otherwise).
  -- The lock makes the 30-day check and the text one step when several people invite them at once.
  if v_status = 'pending' then
    perform public.xact_lock('invitee:' || v_friend);
    if not exists (
      select 1 from public.outbound_messages
      where user_id = v_friend and kind = 'invite' and created_at > now() - interval '30 days'
    ) then
      select display_name into v_my_name from public.profiles where id = v_me;
      v_texted := public.enqueue_message(v_friend, 'invite',
        '[👋 INVITE] ' || v_my_name || ' wants to catch up while brushing. Reply YES to join.', null, null, true) is not null;
    end if;
  end if;
  return jsonb_build_object('friend_id', v_friend, 'status', v_status, 'texted', v_texted);
end $$;

-- ── Phone verification (0006) ─────────────────────────────────────────────────────────────────

create or replace function public.start_phone_verification(p_phone text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me    uuid := public.require_me();
  v_phone text := public.normalize_phone(p_phone);
  v_code  text;
  v_row   public.phone_verifications;
  v_constraint text;
begin
  if v_phone is null or length(v_phone) < 11 then
    raise exception 'Enter your mobile number with area code.';
  end if;
  -- The number before the row, as in complete_phone_verification: the demo trigger (0007) completes the
  -- verification inside the upsert below, while this transaction holds the row.
  perform public.xact_lock('address:' || v_phone);
  if exists (
    select 1 from public.channel_identities ci join public.profiles p on p.id = ci.user_id
    where ci.address = v_phone and ci.verified_at is not null and p.auth_user_id is not null and ci.user_id <> v_me
  ) then
    raise exception 'That number is already linked to another account.';
  end if;

  select * into v_row from public.phone_verifications where user_id = v_me;
  if found and v_row.verified_at is null and v_row.attempts >= 5 and v_row.created_at > now() - interval '1 hour' then
    raise exception 'Too many tries. Wait a few minutes and try again.';
  end if;

  loop
    loop
      v_code := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
      exit when not exists (
        select 1 from public.phone_verifications where code = v_code and verified_at is null and user_id <> v_me
      );
    end loop;

    begin
      insert into public.phone_verifications as v (user_id, phone, code)
      values (v_me, v_phone, v_code)
      on conflict (user_id) do update set
        phone          = excluded.phone,
        code           = excluded.code,
        -- Keep the Photon user when the number is unchanged; the function re-fetches it otherwise.
        photon_user_id = case when v.phone = excluded.phone then v.photon_user_id end,
        line_number    = case when v.phone = excluded.phone then v.line_number end,
        attempts       = case when v.verified_at is null and v.created_at > now() - interval '1 hour' then v.attempts + 1 else 1 end,
        created_at     = now(),
        expires_at     = now() + interval '30 minutes',
        verified_at    = null
      returning * into v_row;
      exit;
    exception when unique_violation then
      -- Someone else drew the same code a moment ago (not yet committed when we checked): draw again.
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint is distinct from 'phone_verifications_open_code' then
        raise;
      end if;
    end;
  end loop;

  return jsonb_build_object('user_id', v_me, 'phone', v_row.phone, 'code', v_row.code, 'expires_at', v_row.expires_at);
end $$;

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
  update public.outbound_messages set user_id = p_into where user_id = p_from;

  update public.channel_identities set user_id = p_into where user_id = p_from;
  delete from public.profiles where id = p_from;  -- cascades settings, sessions, verification
end $$;

-- "Verify 123456" arrived from p_address. The code proves the website session; the sender proves
-- the phone. Both must match the same verification.
create or replace function public.complete_phone_verification(p_channel text, p_address text, p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_addr  text := public.normalize_phone(p_address);
  v_row   public.phone_verifications;
  v_guest uuid;
  v_names text[];
  v_user  uuid;
begin
  -- Before reading anything: waits out invites, inbound texts and other verifications of this number, so
  -- the guest merge below sees their rows. (start_phone_verification already holds it for the demo trigger.)
  perform public.xact_lock('address:' || v_addr);

  select * into v_row from public.phone_verifications where code = p_code and verified_at is null for update;
  if not found then
    -- The same text again (sent twice, or after the demo trigger verified the number): already done, so
    -- stay quiet instead of replying that the code didn't work.
    select user_id into v_user from public.phone_verifications
    where code = p_code and phone = v_addr and verified_at is not null
    order by verified_at desc limit 1;
    if v_user is not null then
      return jsonb_build_object('action', 'ignored', 'user_id', v_user);
    end if;
    return jsonb_build_object('action', 'code_unknown');
  elsif v_row.expires_at < now() then
    return jsonb_build_object('action', 'code_expired', 'user_id', v_row.user_id);
  elsif v_row.phone <> v_addr then
    return jsonb_build_object('action', 'phone_mismatch', 'user_id', v_row.user_id);
  elsif exists (
    select 1 from public.channel_identities ci join public.profiles p on p.id = ci.user_id
    where ci.address = v_addr and ci.verified_at is not null and p.auth_user_id is not null and ci.user_id <> v_row.user_id
  ) then
    return jsonb_build_object('action', 'phone_taken', 'user_id', v_row.user_id);
  end if;

  for v_guest in
    select distinct ci.user_id from public.channel_identities ci join public.profiles p on p.id = ci.user_id
    where ci.address = v_addr and p.auth_user_id is null and ci.user_id <> v_row.user_id
  loop
    perform public.merge_profile_into(v_guest, v_row.user_id);
  end loop;

  -- One messaging number per account: the new one replaces any earlier one.
  delete from public.channel_identities where user_id = v_row.user_id and address <> v_addr;
  insert into public.channel_identities (user_id, channel, address, verified_at)
  values (v_row.user_id, p_channel, v_addr, now())
  on conflict (channel, address) do update set user_id = excluded.user_id, verified_at = now(), opted_out_at = null;

  update public.phone_verifications set verified_at = now() where user_id = v_row.user_id;

  select array_agg(p.display_name order by p.display_name) into v_names
  from public.accepted_friend_ids(v_row.user_id) f join public.profiles p on p.id = f
  where p.display_name <> '';

  return jsonb_build_object(
    'action', 'verified',
    'user_id', v_row.user_id,
    'display_name', (select display_name from public.profiles where id = v_row.user_id),
    'names', coalesce(to_jsonb(v_names), '[]'));
end $$;

-- ── Agent ─────────────────────────────────────────────────────────────────────────────────────

-- Inbound text from Photon. Returns an action for the edge function to reply to.
create or replace function public.agent_handle_inbound(
  p_channel text, p_address text, p_text text,
  p_reply_to text default null, p_reaction text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_addr text := public.normalize_phone(p_address);
  v_user uuid;
  v_cmd text := upper(trim(coalesce(p_text, '')));
  v_code text := substring(coalesce(p_text, '') from '(?i)^\s*verify\W*(\d{6})\M');
  v_check_in uuid;
  v_names text[];
begin
  -- One text at a time per number, never alongside an invite or verification of it. Two first texts
  -- from a new number used to create two guests, and the second one's STOP or YES hit the guest that
  -- ended up with no number.
  perform public.xact_lock('address:' || v_addr);

  if v_code is not null then
    return public.complete_phone_verification(p_channel, v_addr, v_code);
  end if;

  select user_id into v_user from public.channel_identities where channel = p_channel and address = v_addr;
  if v_user is null then
    -- They texted first, so they consented to replies.
    select user_id into v_user from public.channel_identities where address = v_addr limit 1;
    if v_user is null then
      insert into public.profiles default values returning id into v_user;
      insert into public.user_settings (user_id, preferred_channel) values (v_user, p_channel);
    end if;
    insert into public.channel_identities (user_id, channel, address, verified_at)
    values (v_user, p_channel, v_addr, now()) on conflict do nothing;
  end if;

  if v_cmd in ('STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT') then
    update public.channel_identities set opted_out_at = now() where user_id = v_user;
    update public.outbound_messages set status = 'skipped', error = 'opted out' where user_id = v_user and status = 'pending';
    return jsonb_build_object('action', 'stopped', 'user_id', v_user);
  end if;

  if v_cmd in ('START', 'UNSTOP') then
    update public.channel_identities set opted_out_at = null where user_id = v_user;
    return jsonb_build_object('action', 'started', 'user_id', v_user);
  end if;

  -- STOP must always work, even for opted-out addresses; nothing else does.
  if exists (select 1 from public.channel_identities where user_id = v_user and channel = p_channel and address = v_addr and opted_out_at is not null) then
    return jsonb_build_object('action', 'ignored', 'user_id', v_user);
  end if;

  if v_cmd in ('YES', 'Y', 'JOIN') then
    with accepted as (
      update public.friendships set status = 'accepted'
      where (user_a = v_user or user_b = v_user) and status = 'pending' and requested_by <> v_user
      returning requested_by
    )
    select array_agg(p.display_name) into v_names from accepted a join public.profiles p on p.id = a.requested_by;
    return jsonb_build_object('action', case when v_names is null then 'nothing_pending' else 'joined' end,
                              'user_id', v_user, 'names', coalesce(to_jsonb(v_names), '[]'));
  end if;

  if p_reply_to is not null then
    select check_in_id into v_check_in from public.outbound_messages
    where provider_message_id = p_reply_to and user_id = v_user and kind = 'check_in';
  end if;

  if p_reaction is not null then
    if v_check_in is null then
      return jsonb_build_object('action', 'ignored', 'user_id', v_user);
    end if;
    perform public.react_as(v_user, v_check_in,
      case p_reaction when 'laugh' then 'laugh' when 'emphasize' then 'wave' else 'heart' end, null);
    return jsonb_build_object('action', 'reacted', 'user_id', v_user);
  end if;

  if left(trim(coalesce(p_text, '')), 1) = '>' then
    if v_check_in is null then
      select r.check_in_id into v_check_in
      from public.check_in_recipients r join public.check_ins c on c.id = r.check_in_id
      where r.recipient_id = v_user and c.status = 'delivered'
      order by r.delivered_at desc limit 1;
    end if;
    if v_check_in is null then
      return jsonb_build_object('action', 'no_update_to_reply', 'user_id', v_user);
    end if;
    perform public.react_as(v_user, v_check_in, 'reply', substr(trim(p_text), 2));
    return jsonb_build_object('action', 'replied', 'user_id', v_user);
  end if;

  return jsonb_build_object('action', 'help', 'user_id', v_user);
end $$;

-- ── Grants ────────────────────────────────────────────────────────────────────────────────────

-- create or replace keeps the existing functions' grants; the new helper is internal.
revoke execute on function public.xact_lock(text) from public, anon, authenticated;
