-- Let signed-in users add their own phone number, so the messaging agent can text them.
--
-- Everyone signs in with Google, which gives no phone number, so channel_identities had no rows for real
-- users and the agent (backend/src/agent) had nobody to deliver to. set_my_phone saves the number as the
-- user's iMessage address. Within a few seconds the agent registers it with Photon and sends a welcome text
-- (it welcomes identities with verified_at set).
--
-- Hackathon shortcut: the number is self-declared, not confirmed with a code. verified_at means "the owner
-- added it", which is what the agent's welcome logic needs.
--
-- If the number already belongs to a guest profile (created when a friend invited that number by phone),
-- the guest is merged into the caller's account so friendships, invites and received updates carry over.

-- Move everything a guest profile owns onto a real account, then delete the guest.
-- Not granted to any client role; only set_my_phone calls it.
create function public.merge_guest_profile(p_guest uuid, p_into uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  f        public.friendships;
  existing public.friendships;
  v_other  uuid;
  rank_new int;
  rank_old int;
begin
  if p_guest = p_into then
    return;
  end if;
  if exists (select 1 from public.profiles where id = p_guest and auth_user_id is not null) then
    raise exception 'Only guest profiles can be merged.';
  end if;

  -- Friendships: re-point each one at the real account. If both accounts already knew the same person,
  -- keep the stronger state: blocked > accepted > pending.
  for f in select * from public.friendships where user_a = p_guest or user_b = p_guest loop
    delete from public.friendships where user_a = f.user_a and user_b = f.user_b;
    v_other := case when f.user_a = p_guest then f.user_b else f.user_a end;
    continue when v_other = p_into;

    select * into existing from public.friendships
    where user_a = least(p_into, v_other) and user_b = greatest(p_into, v_other);
    if not found then
      insert into public.friendships (user_a, user_b, status, requested_by, blocked_by, created_at)
      values (least(p_into, v_other), greatest(p_into, v_other), f.status,
              case when f.requested_by = p_guest then p_into else f.requested_by end,
              case when f.blocked_by = p_guest then p_into else f.blocked_by end,
              f.created_at);
    else
      rank_new := case f.status when 'blocked' then 3 when 'accepted' then 2 else 1 end;
      rank_old := case existing.status when 'blocked' then 3 when 'accepted' then 2 else 1 end;
      if rank_new > rank_old then
        update public.friendships
        set status = f.status,
            blocked_by = case when f.blocked_by = p_guest then p_into else f.blocked_by end
        where user_a = existing.user_a and user_b = existing.user_b;
      end if;
    end if;
  end loop;

  -- Friends' lists that contained the guest now contain the real account (never your own lists).
  insert into public.friend_list_members (list_id, friend_id)
  select m.list_id, p_into
  from public.friend_list_members m join public.friend_lists l on l.id = m.list_id
  where m.friend_id = p_guest and l.owner_id <> p_into
  on conflict do nothing;

  -- Updates the guest received (read later on the website), except the caller's own.
  insert into public.check_in_recipients (check_in_id, recipient_id, audience_label, channel, delivered_at, seen_at)
  select r.check_in_id, p_into, r.audience_label, r.channel, r.delivered_at, r.seen_at
  from public.check_in_recipients r join public.check_ins c on c.id = r.check_in_id
  where r.recipient_id = p_guest and c.user_id <> p_into
  on conflict do nothing;

  update public.reactions set from_user = p_into where from_user = p_guest;
  update public.reactions set to_user = p_into where to_user = p_guest;
  update public.brush_sessions
    set user_id = p_into, status = case when status = 'active' then 'abandoned' else status end
    where user_id = p_guest;
  update public.check_ins set user_id = p_into where user_id = p_guest;
  update public.outbound_messages set user_id = p_into where user_id = p_guest;
  update public.invites set inviter_id = p_into where inviter_id = p_guest;
  update public.channel_identities set user_id = p_into where user_id = p_guest;

  delete from public.profiles where id = p_guest;  -- cascades settings, lists and leftover rows
end $$;

-- Save (or, with an empty value, remove) the caller's phone number. Returns get_me().
create function public.set_my_phone(p_phone text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me          uuid := public.require_me();
  v_phone       text;
  v_owner       uuid;
  v_owner_auth  uuid;
begin
  if nullif(trim(coalesce(p_phone, '')), '') is null then
    delete from public.channel_identities where user_id = v_me and channel = 'imessage';
    return public.get_me();
  end if;

  v_phone := public.normalize_phone(p_phone);
  if v_phone is null or length(v_phone) < 9 then
    raise exception 'Enter a phone number with area code.';
  end if;
  perform pg_advisory_xact_lock(hashtext('phone:' || v_phone));

  select user_id into v_owner from public.channel_identities
  where address = v_phone
  order by (user_id = v_me) desc
  limit 1;

  if v_owner is not null and v_owner <> v_me then
    select auth_user_id into v_owner_auth from public.profiles where id = v_owner;
    if v_owner_auth is not null then
      raise exception 'That number is already on another account.';
    end if;
    perform public.merge_guest_profile(v_owner, v_me);
  end if;

  -- One iMessage number per person.
  delete from public.channel_identities where user_id = v_me and channel = 'imessage' and address <> v_phone;
  insert into public.channel_identities (user_id, channel, address, verified_at)
  values (v_me, 'imessage', v_phone, now())
  on conflict (channel, address) do update set user_id = v_me, verified_at = now();
  -- opted_out_at is left alone on purpose: if this number texted STOP, it stays stopped.

  return public.get_me();
end $$;

revoke execute on function public.merge_guest_profile(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.set_my_phone(text) from public, anon;
grant execute on function public.set_my_phone(text) to authenticated;
