-- Verify a phone number by texting the Photon line.
--
-- Accounts come from Google sign-in, so they start without a phone number and can't get iMessages.
-- To add one, a user types their number on the website (start_phone_verification), then taps
-- "Text to verify": Messages opens addressed to their Photon line with "Verify 123456" filled in.
-- When the agent receives it (agent_handle_inbound → complete_phone_verification), the sender's
-- number is proven and linked to the account. This also unlocks Photon: shared lines only message
-- numbers that have texted them first.
--
-- If friends invited that number earlier, it has a guest profile. The guest is merged into the
-- account, so its friendships and the updates it received carry over.

create table public.phone_verifications (
  user_id        uuid primary key references public.profiles(id) on delete cascade,
  phone          text not null,        -- the number the user typed, E.164
  code           text not null,        -- 6 digits, texted back to the line
  photon_user_id text,                 -- Photon Spectrum user id, set by the phone-connect function
  line_number    text,                 -- Photon line assigned to this user
  attempts       int not null default 1,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null default now() + interval '30 minutes',
  verified_at    timestamptz
);
create unique index phone_verifications_open_code on public.phone_verifications (code) where verified_at is null;

alter table public.phone_verifications enable row level security;
create policy "own verification" on public.phone_verifications for select to authenticated
  using (user_id = public.me());
revoke all on public.phone_verifications from anon;
revoke insert, update, delete on public.phone_verifications from authenticated;

-- ── Website ───────────────────────────────────────────────────────────────────────────────────

create function public.start_phone_verification(p_phone text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me    uuid := public.require_me();
  v_phone text := public.normalize_phone(p_phone);
  v_code  text;
  v_row   public.phone_verifications;
begin
  if v_phone is null or length(v_phone) < 11 then
    raise exception 'Enter your mobile number with area code.';
  end if;
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
    v_code := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
    exit when not exists (
      select 1 from public.phone_verifications where code = v_code and verified_at is null and user_id <> v_me
    );
  end loop;

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

  return jsonb_build_object('user_id', v_me, 'phone', v_row.phone, 'code', v_row.code, 'expires_at', v_row.expires_at);
end $$;

-- The phone is only reported once verified; an open verification is reported separately.
create or replace function public.get_me() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id,
    'display_name', p.display_name,
    'status', p.status,
    'email', (select email from auth.users where id = auth.uid()),
    'phone', (select address from public.channel_identities
              where user_id = p.id and verified_at is not null and opted_out_at is null
              order by verified_at desc limit 1),
    'phone_verification', (select jsonb_build_object(
                             'phone', v.phone, 'code', v.code, 'photon_user_id', v.photon_user_id,
                             'line_number', v.line_number, 'expires_at', v.expires_at)
                           from public.phone_verifications v
                           where v.user_id = p.id and v.verified_at is null and v.expires_at > now()),
    'settings', to_jsonb(s) - 'user_id'
  )
  from public.profiles p join public.user_settings s on s.user_id = p.id
  where p.id = public.me()
$$;

-- ── Merging a guest into a real account ───────────────────────────────────────────────────────

create function public.merge_profile_into(p_from uuid, p_into uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  f        public.friendships;
  v_other  uuid;
  v_have   public.friendships;
  rank_new int;
  rank_old int;
begin
  if p_from = p_into then
    return;
  end if;

  -- Friendships: re-point to p_into. On a clash keep the stronger status (blocked > accepted > pending).
  for f in select * from public.friendships where p_from in (user_a, user_b) loop
    v_other := case when f.user_a = p_from then f.user_b else f.user_a end;
    delete from public.friendships where user_a = f.user_a and user_b = f.user_b;
    continue when v_other = p_into;  -- e.g. someone invited their own number

    select * into v_have from public.friendships
    where user_a = least(p_into, v_other) and user_b = greatest(p_into, v_other);
    if found then
      rank_new := case f.status when 'blocked' then 3 when 'accepted' then 2 else 1 end;
      rank_old := case v_have.status when 'blocked' then 3 when 'accepted' then 2 else 1 end;
      if rank_new > rank_old then
        update public.friendships
        set status = f.status,
            blocked_by = case when f.blocked_by = p_from then p_into else f.blocked_by end
        where user_a = v_have.user_a and user_b = v_have.user_b;
      end if;
    else
      insert into public.friendships (user_a, user_b, status, requested_by, blocked_by, created_at)
      values (least(p_into, v_other), greatest(p_into, v_other), f.status,
              case when f.requested_by = p_from then p_into else f.requested_by end,
              case when f.blocked_by = p_from then p_into else f.blocked_by end,
              f.created_at);
    end if;
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

-- ── Agent ─────────────────────────────────────────────────────────────────────────────────────

-- "Verify 123456" arrived from p_address. The code proves the website session; the sender proves
-- the phone. Both must match the same verification.
create function public.complete_phone_verification(p_channel text, p_address text, p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_addr  text := public.normalize_phone(p_address);
  v_row   public.phone_verifications;
  v_guest uuid;
  v_names text[];
begin
  select * into v_row from public.phone_verifications where code = p_code and verified_at is null for update;
  if not found then
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

-- Same as before, plus: a "Verify 123456" text completes phone verification before anything else
-- (so an unknown sender verifying their number doesn't become a guest first).
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

revoke execute on function public.start_phone_verification(text), public.merge_profile_into(uuid, uuid),
  public.complete_phone_verification(text, text, text) from public, anon, authenticated;
grant execute on function public.start_phone_verification(text) to authenticated;
grant execute on function public.complete_phone_verification(text, text, text), public.merge_profile_into(uuid, uuid)
  to service_role;
