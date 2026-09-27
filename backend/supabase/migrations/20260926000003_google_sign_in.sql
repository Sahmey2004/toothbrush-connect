-- Google sign-in: new accounts have an email and a Google name but no phone yet.
-- Phone numbers (needed for iMessage delivery) are added later.

create or replace function public.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_phone text := public.normalize_phone(new.phone);
  v_name text := left(trim(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', '')), 40);
  v_profile uuid;
begin
  if v_phone is not null then
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
    insert into public.channel_identities (user_id, channel, address, verified_at)
    values (v_profile, 'imessage', v_phone, now())
    on conflict (channel, address) do update set verified_at = now()
      where public.channel_identities.user_id = v_profile;
  end if;
  return new;
end $$;

create or replace function public.get_me() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id,
    'display_name', p.display_name,
    'status', p.status,
    'email', (select email from auth.users where id = auth.uid()),
    'phone', (select address from public.channel_identities where user_id = p.id order by verified_at desc nulls last limit 1),
    'settings', to_jsonb(s) - 'user_id'
  )
  from public.profiles p join public.user_settings s on s.user_id = p.id
  where p.id = public.me()
$$;
