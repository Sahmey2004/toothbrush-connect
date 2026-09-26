-- Add friends by the email they signed in with.
--
-- Everyone signs in with Google, and Google accounts have no phone number, so invite_friend could
-- never find a real account by phone: it created a guest profile for the number instead and the
-- friend never saw the request. invite_friend now also takes an email address (same parameter,
-- so the website's existing call keeps working). Phone numbers work as before.

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
    select user_id into v_friend from public.channel_identities where address = v_phone limit 1;
    if v_friend is null then
      insert into public.profiles (display_name) values (left(coalesce(trim(p_name), ''), 40)) returning id into v_friend;
      insert into public.user_settings (user_id) values (v_friend);
      insert into public.channel_identities (user_id, channel, address) values (v_friend, 'imessage', v_phone);
    end if;
  end if;

  v_status := public.link_friends(v_me, v_friend, false);

  -- Text an invite only if they have a messaging address (enqueue_message returns null otherwise).
  if v_status = 'pending' and not exists (
    select 1 from public.outbound_messages
    where user_id = v_friend and kind = 'invite' and created_at > now() - interval '30 days'
  ) then
    select display_name into v_my_name from public.profiles where id = v_me;
    v_texted := public.enqueue_message(v_friend, 'invite',
      '[👋 INVITE] ' || v_my_name || ' wants to catch up while brushing. Reply YES to join.', null, null, true) is not null;
  end if;
  return jsonb_build_object('friend_id', v_friend, 'status', v_status, 'texted', v_texted);
end $$;
