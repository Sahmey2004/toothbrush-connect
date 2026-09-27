-- Policies and RPCs. The website calls these through supabase-js (`supabase.rpc(...)`);
-- the agent edge functions call the service-role-only ones.
-- Every function is security definer with an empty search_path, so all names are schema-qualified.

-- ── Identity helpers ──────────────────────────────────────────────────────────────────────────

create function public.me() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.profiles where auth_user_id = auth.uid()
$$;

create function public.normalize_phone(p text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p is null then null
    when regexp_replace(p, '\D', '', 'g') = '' then null
    when left(trim(p), 1) = '+' then '+' || regexp_replace(p, '\D', '', 'g')
    when length(regexp_replace(p, '\D', '', 'g')) = 10 then '+1' || regexp_replace(p, '\D', '', 'g')
    else '+' || regexp_replace(p, '\D', '', 'g')
  end
$$;

create function public.are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.friendships
    where user_a = least(a, b) and user_b = greatest(a, b) and status = 'accepted'
  )
$$;

create function public.accepted_friend_ids(u uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select case when user_a = u then user_b else user_a end
  from public.friendships
  where (user_a = u or user_b = u) and status = 'accepted'
$$;

-- FR-R5: is `viewer` told that `owner` is brushing?
create function public.in_presence_audience(owner uuid, viewer uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select owner <> viewer
    and public.are_friends(owner, viewer)
    and exists (
      select 1 from public.user_settings s
      where s.user_id = owner
        and not s.invisible
        and (
          coalesce(s.presence_list_id, s.default_list_id) is null
          or exists (
            select 1 from public.friend_list_members m
            where m.list_id = coalesce(s.presence_list_id, s.default_list_id) and m.friend_id = viewer
          )
        )
    )
$$;

-- Used by the check_ins / check_in_recipients policies; security definer so the two policies
-- don't recurse into each other.
create function public.is_recipient(p_check_in uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.check_in_recipients where check_in_id = p_check_in and recipient_id = p_user)
$$;

create function public.check_in_author(p_check_in uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select user_id from public.check_ins where id = p_check_in
$$;

create function public.require_me() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v uuid := public.me();
begin
  if v is null then
    raise exception 'Sign in to continue.' using errcode = '28000';
  end if;
  return v;
end $$;

-- ── Labels (PRD label catalog) ────────────────────────────────────────────────────────────────

create function public.mood_word(m text) returns text
language sql immutable set search_path = '' as $$
  select case m when 'fun' then 'FUN' when 'stressful' then 'STRESSFUL' when 'boring' then 'BORING' else 'JUST OKAY' end
$$;

create function public.mood_emoji(m text) returns text
language sql immutable set search_path = '' as $$
  select case m when 'fun' then '😄' when 'stressful' then '😣' when 'boring' then '😐' else '🙂' end
$$;

-- `[😄 FUN · this week] Aisha: "got the job!!"`, `[👥 CLOSE CIRCLE · FUN] …`, `[💌 JUST FOR YOU · FUN] …`
create function public.check_in_message(p_mood text, p_scope text, p_text text, p_label text, p_author text) returns text
language sql immutable set search_path = '' as $$
  select '[' || case p_label
      when 'everyone' then public.mood_emoji(p_mood) || ' ' || public.mood_word(p_mood) || ' · '
                           || case p_scope when 'this_week' then 'this week' else 'today' end
      when 'close_circle' then '👥 CLOSE CIRCLE · ' || public.mood_word(p_mood)
      else '💌 JUST FOR YOU · ' || public.mood_word(p_mood)
    end || '] ' || p_author || coalesce(': "' || p_text || '"', '')
$$;

-- ── Agent outbox ──────────────────────────────────────────────────────────────────────────────

-- FR-A3: earliest time a proactive message may reach this user.
create function public.next_send_time(p_user uuid) returns timestamptz
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.user_settings;
  local_ts timestamp;
  t time;
begin
  select * into s from public.user_settings where user_id = p_user;
  if not found or s.quiet_start = s.quiet_end then
    return now();
  end if;
  local_ts := now() at time zone s.timezone;
  t := local_ts::time;
  if s.quiet_start > s.quiet_end then  -- wraps midnight, e.g. 23:00–07:00
    if t >= s.quiet_start then
      return ((local_ts::date + 1) + s.quiet_end) at time zone s.timezone;
    elsif t < s.quiet_end then
      return (local_ts::date + s.quiet_end) at time zone s.timezone;
    end if;
  elsif t >= s.quiet_start and t < s.quiet_end then
    return (local_ts::date + s.quiet_end) at time zone s.timezone;
  end if;
  return now();
end $$;

-- Queue one agent message on the user's preferred messaging channel. Returns null when the user
-- reads on the web only, has no messaging address, or opted out.
create function public.enqueue_message(
  p_user uuid, p_kind text, p_body text,
  p_check_in uuid default null, p_effect text default null, p_respect_quiet boolean default true
) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_pref text;
  v_ident public.channel_identities;
  v_id bigint;
begin
  select preferred_channel into v_pref from public.user_settings where user_id = p_user;
  if v_pref is null or v_pref = 'web' then
    return null;
  end if;
  select * into v_ident from public.channel_identities
  where user_id = p_user and opted_out_at is null
  order by (channel = v_pref) desc, case channel when 'imessage' then 1 when 'whatsapp' then 2 else 3 end
  limit 1;
  if not found then
    return null;
  end if;
  insert into public.outbound_messages (user_id, channel, address, kind, body, effect, check_in_id, send_after)
  values (p_user, v_ident.channel, v_ident.address, p_kind, p_body, p_effect, p_check_in,
          case when p_respect_quiet then public.next_send_time(p_user) else now() end)
  on conflict do nothing
  returning id into v_id;
  return v_id;
end $$;

-- ── New sign-ins ──────────────────────────────────────────────────────────────────────────────

-- Signing in with a phone number either claims the guest profile a friend created by inviting
-- that number, or creates a new profile.
create function public.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_phone text := public.normalize_phone(new.phone);
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
    insert into public.profiles (auth_user_id) values (new.id) returning id into v_profile;
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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ── Account ───────────────────────────────────────────────────────────────────────────────────

create function public.get_me() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id,
    'display_name', p.display_name,
    'status', p.status,
    'phone', (select address from public.channel_identities where user_id = p.id order by verified_at desc nulls last limit 1),
    'settings', to_jsonb(s) - 'user_id'
  )
  from public.profiles p join public.user_settings s on s.user_id = p.id
  where p.id = public.me()
$$;

-- Flow A: display name and usual brushing times.
create function public.complete_onboarding(p_display_name text, p_timezone text, p_brush_times text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := public.require_me();
begin
  if coalesce(trim(p_display_name), '') = '' then
    raise exception 'Add a name so friends know who you are.';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    p_timezone := 'UTC';
  end if;
  update public.profiles set display_name = left(trim(p_display_name), 40), status = 'active' where id = v_me;
  update public.user_settings
  set timezone = p_timezone,
      brush_times = coalesce(p_brush_times, '{}'),
      onboarded_at = coalesce(onboarded_at, now())
  where user_id = v_me;
  return public.get_me();
end $$;

-- FR-A6
create function public.export_my_data() returns jsonb
language sql stable security definer set search_path = '' as $$
  with m as (select public.require_me() as id)
  select jsonb_build_object(
    'exported_at', now(),
    'profile', (select to_jsonb(p) from public.profiles p, m where p.id = m.id),
    'settings', (select to_jsonb(s) from public.user_settings s, m where s.user_id = m.id),
    'channels', (select coalesce(jsonb_agg(to_jsonb(c)), '[]') from public.channel_identities c, m where c.user_id = m.id),
    'friendships', (select coalesce(jsonb_agg(to_jsonb(f)), '[]') from public.friendships f, m where m.id in (f.user_a, f.user_b)),
    'lists', (select coalesce(jsonb_agg(to_jsonb(l) || jsonb_build_object('members',
                (select coalesce(jsonb_agg(friend_id), '[]') from public.friend_list_members where list_id = l.id))), '[]')
              from public.friend_lists l, m where l.owner_id = m.id),
    'sessions', (select coalesce(jsonb_agg(to_jsonb(b)), '[]') from public.brush_sessions b, m where b.user_id = m.id),
    'check_ins', (select coalesce(jsonb_agg(to_jsonb(c)), '[]') from public.check_ins c, m where c.user_id = m.id),
    'reactions_sent', (select coalesce(jsonb_agg(to_jsonb(r)), '[]') from public.reactions r, m where r.from_user = m.id)
  )
$$;

create function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := public.require_me();
begin
  delete from public.profiles where id = v_me;
  delete from auth.users where id = auth.uid();
end $$;

-- ── Sessions ──────────────────────────────────────────────────────────────────────────────────

-- FR-P1 / FR-P3: tell friends in the presence audience. Web readers get this through Realtime on
-- brush_sessions (RLS-filtered); messaging readers get a [🪥 BRUSHING NOW] text.
create function public.notify_presence(p_owner uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
  v_friend uuid;
begin
  select display_name into v_name from public.profiles where id = p_owner;
  for v_friend in select f from public.accepted_friend_ids(p_owner) f where public.in_presence_audience(p_owner, f) loop
    if exists (select 1 from public.brush_sessions where user_id = v_friend and status = 'active' and ends_at > now()) then
      perform public.enqueue_message(v_friend, 'presence', '[🪥 BRUSHING NOW] ' || v_name || ' is brushing too 👋', null, null, false);
    elsif public.next_send_time(v_friend) <= now()
      and not exists (
        select 1 from public.outbound_messages
        where user_id = v_friend and kind = 'presence_proactive' and created_at > now() - interval '1 day'
      ) then
      perform public.enqueue_message(v_friend, 'presence_proactive', '[🪥 BRUSHING NOW] ' || v_name || ' is brushing right now.', null, null, true);
    end if;
  end loop;
end $$;

create function public.start_session(p_channel text default 'web') returns public.brush_sessions
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public.require_me();
  v_s public.brush_sessions;
begin
  update public.brush_sessions set status = 'completed', ended_at = ends_at
  where user_id = v_me and status = 'active' and ends_at <= now();

  select * into v_s from public.brush_sessions where user_id = v_me and status = 'active';
  if found then
    return v_s;  -- idempotent per user
  end if;

  insert into public.brush_sessions (user_id, channel) values (v_me, p_channel) returning * into v_s;
  perform public.notify_presence(v_me);
  return v_s;
end $$;

-- FR-T5: end early.
create function public.end_session(p_session_id uuid) returns public.brush_sessions
language plpgsql security definer set search_path = '' as $$
declare v_s public.brush_sessions;
begin
  update public.brush_sessions set status = 'completed', ended_at = least(now(), ends_at)
  where id = p_session_id and user_id = public.require_me() and status = 'active'
  returning * into v_s;
  return v_s;
end $$;

-- ── Check-ins ─────────────────────────────────────────────────────────────────────────────────

create function public.validate_audience(p_owner uuid, p_type text, p_list uuid, p_friends uuid[]) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_type = 'list' then
    if not exists (select 1 from public.friend_lists where id = p_list and owner_id = p_owner) then
      raise exception 'That list no longer exists.';
    end if;
  elsif p_type = 'custom' then
    if coalesce(cardinality(p_friends), 0) = 0 then
      raise exception 'Pick at least one friend.';
    end if;
    if exists (select 1 from unnest(p_friends) f where not public.are_friends(p_owner, f)) then
      raise exception 'You can only send updates to friends in your circle.';
    end if;
  elsif p_type is distinct from 'everyone' then
    raise exception 'Unknown audience %', p_type;
  end if;
end $$;

-- FR-C1..C3, FR-C6, FR-R1, FR-R2, FR-R4: create a held check-in (or replace this session's held one).
create function public.post_check_in(
  p_mood text, p_scope text default 'today', p_text text default null,
  p_audience_type text default null, p_list_id uuid default null, p_friend_ids uuid[] default null
) returns public.check_ins
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public.require_me();
  v_session uuid;
  v_text text := left(nullif(trim(p_text), ''), 140);
  v_type text := p_audience_type;
  v_list uuid := p_list_id;
  v_c public.check_ins;
begin
  if v_type is null then
    select case when default_list_id is null then 'everyone' else 'list' end, default_list_id
    into v_type, v_list
    from public.user_settings where user_id = v_me;
  end if;
  if v_type = 'everyone' then v_list := null; end if;
  perform public.validate_audience(v_me, v_type, v_list, p_friend_ids);

  select id into v_session from public.brush_sessions
  where user_id = v_me and status = 'active' and ends_at > now();

  if v_session is not null then
    select * into v_c from public.check_ins
    where session_id = v_session and status in ('held', 'delivered')
    order by created_at desc limit 1 for update;
    if found and v_c.status = 'delivered' then
      raise exception 'You already checked in this session. Edit your update instead.';
    elsif found then
      update public.check_ins
      set mood = p_mood, scope = coalesce(p_scope, 'today'), text = v_text,
          audience_type = v_type, list_id = v_list,
          friend_ids = case when v_type = 'custom' then p_friend_ids else '{}' end,
          deliver_at = now() + interval '30 seconds'
      where id = v_c.id
      returning * into v_c;
      return v_c;
    end if;
  end if;

  insert into public.check_ins (user_id, session_id, mood, scope, text, audience_type, list_id, friend_ids)
  values (v_me, v_session, p_mood, coalesce(p_scope, 'today'), v_text, v_type, v_list,
          case when v_type = 'custom' then p_friend_ids else '{}' end)
  returning * into v_c;
  update public.profiles set status = 'active' where id = v_me and status = 'guest';
  return v_c;
end $$;

-- Resolve the audience into recipients, write one row each, and queue their messages.
create function public.deliver_check_in(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_c public.check_ins;
  v_author text;
  v_label text;
  v_count int;
  v_recips uuid[];
  v_r uuid;
begin
  select * into v_c from public.check_ins where id = p_id and status = 'held' for update skip locked;
  if not found then
    return;
  end if;

  v_recips := array(
    select f from public.accepted_friend_ids(v_c.user_id) f
    where case v_c.audience_type
      when 'everyone' then true
      when 'list' then exists (select 1 from public.friend_list_members m where m.list_id = v_c.list_id and m.friend_id = f)
      else f = any (v_c.friend_ids)
    end
  );
  v_count := cardinality(v_recips);
  v_label := case when v_c.audience_type = 'everyone' then 'everyone' when v_count = 1 then 'just_for_you' else 'close_circle' end;
  select display_name into v_author from public.profiles where id = v_c.user_id;

  insert into public.check_in_recipients (check_in_id, recipient_id, audience_label, channel)
  select v_c.id, r, v_label, coalesce(s.preferred_channel, 'imessage')
  from unnest(v_recips) r left join public.user_settings s on s.user_id = r
  on conflict do nothing;

  foreach v_r in array v_recips loop
    perform public.enqueue_message(v_r, 'check_in',
      public.check_in_message(v_c.mood, v_c.scope, v_c.text, v_label, v_author), v_c.id, null, true);
  end loop;

  update public.check_ins set status = 'delivered', delivered_at = now() where id = v_c.id;
end $$;

-- FR-R3 / FR-R9: choosing an audience during the hold sends immediately.
create function public.set_check_in_audience(
  p_id uuid, p_audience_type text, p_list_id uuid default null, p_friend_ids uuid[] default null,
  p_make_default boolean default false
) returns public.check_ins
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public.require_me();
  v_c public.check_ins;
begin
  if p_audience_type = 'everyone' then p_list_id := null; end if;
  perform public.validate_audience(v_me, p_audience_type, p_list_id, p_friend_ids);
  update public.check_ins
  set audience_type = p_audience_type, list_id = p_list_id,
      friend_ids = case when p_audience_type = 'custom' then p_friend_ids else '{}' end
  where id = p_id and user_id = v_me and status = 'held'
  returning * into v_c;
  if not found then
    raise exception 'This update was already sent, so its audience can''t change.';
  end if;
  if p_make_default and p_audience_type in ('everyone', 'list') then
    update public.user_settings set default_list_id = p_list_id where user_id = v_me;
  end if;
  perform public.deliver_check_in(p_id);
  select * into v_c from public.check_ins where id = p_id;
  return v_c;
end $$;

-- FR-C4
create function public.undo_check_in(p_id uuid) returns public.check_ins
language plpgsql security definer set search_path = '' as $$
declare v_c public.check_ins;
begin
  update public.check_ins set status = 'undone'
  where id = p_id and user_id = public.require_me() and status = 'held'
  returning * into v_c;
  if not found then
    raise exception 'This update was already sent. Delete it instead.';
  end if;
  return v_c;
end $$;

create function public.delete_check_in(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.check_ins set status = case when status = 'held' then 'undone' else 'deleted' end
  where id = p_id and user_id = public.require_me() and status in ('held', 'delivered');
end $$;

-- FR-C5: edit within 10 minutes; recipients get [✏️ EDITED] only if already delivered.
create function public.edit_check_in(p_id uuid, p_text text, p_mood text default null) returns public.check_ins
language plpgsql security definer set search_path = '' as $$
declare
  v_c public.check_ins;
  v_author text;
  v_r uuid;
begin
  update public.check_ins
  set text = left(nullif(trim(p_text), ''), 140),
      mood = coalesce(p_mood, mood),
      edited_at = case when status = 'delivered' then now() else edited_at end
  where id = p_id and user_id = public.require_me()
    and status in ('held', 'delivered') and created_at > now() - interval '10 minutes'
  returning * into v_c;
  if not found then
    raise exception 'Updates can only be edited for 10 minutes after posting.';
  end if;
  if v_c.status = 'delivered' then
    select display_name into v_author from public.profiles where id = v_c.user_id;
    for v_r in select recipient_id from public.check_in_recipients where check_in_id = v_c.id loop
      perform public.enqueue_message(v_r, 'edited',
        '[✏️ EDITED] ' || v_author || coalesce(': "' || v_c.text || '"', ' changed their update to ' || public.mood_word(v_c.mood)),
        v_c.id, null, true);
    end loop;
  end if;
  return v_c;
end $$;

-- ── Reading ───────────────────────────────────────────────────────────────────────────────────

-- FR-S4: check-ins the caller received (never anyone else's), newest first.
create function public.get_feed(p_days int default 14)
returns table (
  check_in_id uuid, author_id uuid, author_name text, mood text, scope text, text text,
  audience_label text, delivered_at timestamptz, edited_at timestamptz, seen_at timestamptz, my_reaction text
)
language sql stable security definer set search_path = '' as $$
  select c.id, c.user_id, p.display_name, c.mood, c.scope, c.text,
         r.audience_label, r.delivered_at, c.edited_at, r.seen_at,
         (select x.kind from public.reactions x
          where x.check_in_id = c.id and x.from_user = r.recipient_id and x.kind <> 'reply'
          order by x.created_at desc limit 1)
  from public.check_in_recipients r
  join public.check_ins c on c.id = r.check_in_id
  join public.profiles p on p.id = c.user_id
  where r.recipient_id = public.me()
    and c.status = 'delivered'
    and r.delivered_at > now() - make_interval(days => greatest(1, least(p_days, 60)))
  order by r.delivered_at desc
$$;

create function public.mark_seen(p_ids uuid[]) returns void
language sql security definer set search_path = '' as $$
  update public.check_in_recipients set seen_at = now()
  where recipient_id = public.me() and check_in_id = any (p_ids) and seen_at is null
$$;

-- FR-S3: friends (and pending requests) with the latest check-in the caller is allowed to see.
create function public.get_circle()
returns table (
  friend_id uuid, display_name text, friendship_status text, requested_by_me boolean, is_guest boolean,
  brushing_now boolean, latest_check_in_id uuid, latest_mood text, latest_scope text, latest_text text,
  latest_audience_label text, latest_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  with m as (select public.me() as id)
  select p.id, p.display_name, f.status, f.requested_by = m.id, p.auth_user_id is null,
         f.status = 'accepted' and exists (
           select 1 from public.brush_sessions s
           where s.user_id = p.id and s.status = 'active' and s.ends_at > now()
             and public.in_presence_audience(p.id, m.id)
         ),
         lc.id, lc.mood, lc.scope, lc.text, lc.audience_label, lc.delivered_at
  from m
  join public.friendships f on m.id in (f.user_a, f.user_b)
  join public.profiles p on p.id = case when f.user_a = m.id then f.user_b else f.user_a end
  left join lateral (
    select c.id, c.mood, c.scope, c.text, r.audience_label, r.delivered_at
    from public.check_in_recipients r join public.check_ins c on c.id = r.check_in_id
    where r.recipient_id = m.id and c.user_id = p.id and c.status = 'delivered'
    order by r.delivered_at desc limit 1
  ) lc on true
  where f.status in ('pending', 'accepted')
  order by f.status = 'accepted' desc, lc.delivered_at desc nulls last, p.display_name
$$;

-- ── Circle ────────────────────────────────────────────────────────────────────────────────────

create function public.circle_size(u uuid) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.friendships
  where (user_a = u or user_b = u) and status in ('pending', 'accepted')
$$;

-- Returns 'accepted' | 'pending' | 'already_friends'. Raises if blocked either way.
create function public.link_friends(p_me uuid, p_other uuid, p_accept boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare f public.friendships;
begin
  if p_me = p_other then
    raise exception 'That''s your own number.';
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
  if public.circle_size(p_me) >= 25 then
    raise exception 'Your circle is full (25 friends).';
  end if;
  insert into public.friendships (user_a, user_b, status, requested_by)
  values (least(p_me, p_other), greatest(p_me, p_other), case when p_accept then 'accepted' else 'pending' end, p_me);
  return case when p_accept then 'accepted' else 'pending' end;
end $$;

-- FR-S1 / FR-S2: invite by phone. Creates a guest friend if the number is new and texts one
-- [👋 INVITE] per invitee per 30 days.
create function public.invite_friend(p_phone text, p_name text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public.require_me();
  v_phone text := public.normalize_phone(p_phone);
  v_friend uuid;
  v_status text;
  v_texted boolean := false;
  v_my_name text;
begin
  if v_phone is null or length(v_phone) < 9 then
    raise exception 'Enter a phone number with area code.';
  end if;
  select user_id into v_friend from public.channel_identities where address = v_phone limit 1;
  if v_friend is null then
    insert into public.profiles (display_name) values (left(coalesce(trim(p_name), ''), 40)) returning id into v_friend;
    insert into public.user_settings (user_id) values (v_friend);
    insert into public.channel_identities (user_id, channel, address) values (v_friend, 'imessage', v_phone);
  end if;

  v_status := public.link_friends(v_me, v_friend, false);

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

create function public.create_invite_link() returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public.require_me();
  v_token text;
begin
  select token into v_token from public.invites
  where inviter_id = v_me and expires_at > now() + interval '1 day'
  order by created_at desc limit 1;
  if v_token is null then
    insert into public.invites (inviter_id) values (v_me) returning token into v_token;
  end if;
  return v_token;
end $$;

-- Public: lets the invite page show who is inviting before sign-in.
create function public.get_invite(p_token text) returns table (inviter_name text)
language sql stable security definer set search_path = '' as $$
  select p.display_name from public.invites i join public.profiles p on p.id = i.inviter_id
  where i.token = p_token and i.expires_at > now()
$$;

create function public.accept_invite(p_token text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public.require_me();
  v_inviter uuid;
begin
  select inviter_id into v_inviter from public.invites where token = p_token and expires_at > now();
  if v_inviter is null then
    raise exception 'This invite link has expired. Ask your friend for a new one.';
  end if;
  return public.link_friends(v_me, v_inviter, true);
end $$;

create function public.respond_to_friend(p_friend uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := public.require_me();
begin
  if p_accept then
    update public.friendships set status = 'accepted'
    where user_a = least(v_me, p_friend) and user_b = greatest(v_me, p_friend)
      and status = 'pending' and requested_by = p_friend;
  else
    delete from public.friendships
    where user_a = least(v_me, p_friend) and user_b = greatest(v_me, p_friend) and status = 'pending';
  end if;
end $$;

create function public.drop_list_memberships(a uuid, b uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.friend_list_members m using public.friend_lists l
  where m.list_id = l.id and ((l.owner_id = a and m.friend_id = b) or (l.owner_id = b and m.friend_id = a))
$$;

-- FR-S5
create function public.remove_friend(p_friend uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := public.require_me();
begin
  delete from public.friendships
  where user_a = least(v_me, p_friend) and user_b = greatest(v_me, p_friend) and status <> 'blocked';
  perform public.drop_list_memberships(v_me, p_friend);
end $$;

create function public.block_friend(p_friend uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := public.require_me();
begin
  insert into public.friendships (user_a, user_b, status, requested_by, blocked_by)
  values (least(v_me, p_friend), greatest(v_me, p_friend), 'blocked', v_me, v_me)
  on conflict (user_a, user_b) do update set status = 'blocked', blocked_by = v_me;
  perform public.drop_list_memberships(v_me, p_friend);
end $$;

-- ── Reactions ─────────────────────────────────────────────────────────────────────────────────

create function public.react_as(p_from uuid, p_check_in uuid, p_kind text, p_text text) returns public.reactions
language plpgsql security definer set search_path = '' as $$
declare
  v_author uuid;
  v_name text;
  v_row public.reactions;
begin
  select c.user_id into v_author
  from public.check_ins c join public.check_in_recipients r on r.check_in_id = c.id
  where c.id = p_check_in and r.recipient_id = p_from and c.status = 'delivered';
  if v_author is null then
    raise exception 'You can only react to updates sent to you.';
  end if;
  if p_kind = 'reply' and coalesce(trim(p_text), '') = '' then
    raise exception 'Write a reply first.';
  end if;
  insert into public.reactions (from_user, to_user, check_in_id, kind, text)
  values (p_from, v_author, p_check_in, p_kind, case when p_kind = 'reply' then left(trim(p_text), 280) end)
  returning * into v_row;

  select display_name into v_name from public.profiles where id = p_from;
  perform public.enqueue_message(v_author, p_kind,
    case p_kind
      when 'reply' then '[💬 REPLY] from ' || v_name || ': "' || v_row.text || '"'
      when 'heart' then '[❤️ REACTION] ' || v_name || ' loved your update'
      when 'laugh' then '[❤️ REACTION] ' || v_name || ' laughed at your update'
      else '[❤️ REACTION] ' || v_name || ' waved 👋'
    end, null, null, true);
  return v_row;
end $$;

-- FR-P5 / FR-M8
create function public.send_reaction(p_check_in uuid, p_kind text, p_text text default null) returns public.reactions
language sql security definer set search_path = '' as $$
  select * from public.react_as(public.require_me(), p_check_in, p_kind, p_text)
$$;

-- ── Scheduler ─────────────────────────────────────────────────────────────────────────────────

-- Asks the agent-dispatch edge function to drain the outbox. Needs two Vault secrets
-- (see README): project_url and service_role_key. Without them it does nothing.
create function public.invoke_agent_dispatch() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_key text;
begin
  if not exists (select 1 from public.outbound_messages where status = 'pending' and send_after <= now()) then
    return;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
  if v_url is null or v_key is null then
    return;
  end if;
  perform net.http_post(
    url := v_url || '/functions/v1/agent-dispatch',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := '{}'::jsonb
  );
end $$;

-- 30 s delivery hold, 2:00 DONE, and outbox dispatch. Runs every 5 s via pg_cron; the website also
-- calls it when a hold or timer runs out, so local dev works without waiting for cron.
create function public.run_due_jobs() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_s public.brush_sessions;
  v_n int;
begin
  for v_id in select id from public.check_ins where status = 'held' and deliver_at <= now() order by deliver_at loop
    perform public.deliver_check_in(v_id);
  end loop;

  for v_s in
    update public.brush_sessions set status = 'completed', ended_at = ends_at
    where status = 'active' and ends_at <= now()
    returning *
  loop
    if v_s.channel <> 'web' then
      select count(distinct c.user_id) into v_n
      from public.check_in_recipients r join public.check_ins c on c.id = r.check_in_id
      where r.recipient_id = v_s.user_id and c.status = 'delivered' and r.delivered_at > now() - interval '1 day';
      perform public.enqueue_message(v_s.user_id, 'done',
        '[🎉 DONE] 2 minutes up. You caught up with ' || v_n || case when v_n = 1 then ' friend.' else ' friends.' end,
        null, 'confetti', false);
    end if;
  end loop;

  begin
    perform public.invoke_agent_dispatch();
  exception when others then
    raise warning 'agent dispatch failed: %', sqlerrm;
  end;
end $$;

-- ── Agent (service role only) ─────────────────────────────────────────────────────────────────

-- Claim due messages for sending; skips opted-out addresses and retries stuck sends.
create function public.claim_outbound(p_limit int default 50) returns setof public.outbound_messages
language plpgsql security definer set search_path = '' as $$
begin
  update public.outbound_messages o set status = 'skipped', error = 'opted out'
  from public.channel_identities ci
  where o.status = 'pending' and ci.channel = o.channel and ci.address = o.address
    and ci.opted_out_at is not null and o.kind <> 'system';

  update public.outbound_messages set status = 'pending'
  where status = 'sending' and sent_at is null and created_at < now() - interval '2 minutes' and attempts < 3;

  return query
  update public.outbound_messages set status = 'sending', attempts = attempts + 1
  where id in (
    select id from public.outbound_messages
    where status = 'pending' and send_after <= now()
    order by id limit p_limit
    for update skip locked
  )
  returning *;
end $$;

create function public.complete_outbound(p_id bigint, p_ok boolean, p_provider_message_id text default null, p_error text default null)
returns void
language sql security definer set search_path = '' as $$
  update public.outbound_messages
  set status = case when p_ok then 'sent' when attempts >= 3 then 'failed' else 'pending' end,
      sent_at = case when p_ok then now() end,
      send_after = case when p_ok then send_after else now() + interval '30 seconds' end,
      provider_message_id = p_provider_message_id,
      error = p_error
  where id = p_id
$$;

-- Inbound text from Photon. Returns an action for the edge function to reply to.
-- p_reply_to is the provider id of the agent message the user tapped back on or replied to.
create function public.agent_handle_inbound(
  p_channel text, p_address text, p_text text,
  p_reply_to text default null, p_reaction text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_addr text := public.normalize_phone(p_address);
  v_user uuid;
  v_cmd text := upper(trim(coalesce(p_text, '')));
  v_check_in uuid;
  v_names text[];
begin
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

-- ── Table triggers ────────────────────────────────────────────────────────────────────────────

-- FR-R6: at most 10 lists per owner, each addressable by a letter A–J.
create function public.friend_lists_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.owner_id := coalesce(new.owner_id, public.me());
  if (select count(*) from public.friend_lists where owner_id = new.owner_id) >= 10 then
    raise exception 'You can have up to 10 lists.';
  end if;
  select l into new.letter
  from unnest(string_to_array('A,B,C,D,E,F,G,H,I,J', ',')) l
  where l not in (select letter from public.friend_lists where owner_id = new.owner_id)
  order by l limit 1;
  return new;
end $$;
create trigger friend_lists_before_insert before insert on public.friend_lists
  for each row execute function public.friend_lists_before_insert();

create function public.friend_list_members_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not public.are_friends((select owner_id from public.friend_lists where id = new.list_id), new.friend_id) then
    raise exception 'Only friends in your circle can be added to a list.';
  end if;
  return new;
end $$;
create trigger friend_list_members_check before insert or update on public.friend_list_members
  for each row execute function public.friend_list_members_check();

create function public.user_settings_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.default_list_id is not null and not exists (select 1 from public.friend_lists where id = new.default_list_id and owner_id = new.user_id)
     or new.presence_list_id is not null and not exists (select 1 from public.friend_lists where id = new.presence_list_id and owner_id = new.user_id) then
    raise exception 'That list no longer exists.';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Unknown time zone %', new.timezone;
  end if;
  return new;
end $$;
create trigger user_settings_check before update on public.user_settings
  for each row execute function public.user_settings_check();

-- ── Policies ──────────────────────────────────────────────────────────────────────────────────

create policy "see self and people in my circle" on public.profiles for select to authenticated
  using (
    id = public.me() or exists (
      select 1 from public.friendships f
      where f.user_a = least(id, public.me()) and f.user_b = greatest(id, public.me())
        and (f.status <> 'blocked' or f.blocked_by = public.me())
    )
  );
create policy "update own profile" on public.profiles for update to authenticated
  using (id = public.me()) with check (id = public.me());

create policy "own settings" on public.user_settings for select to authenticated using (user_id = public.me());
create policy "update own settings" on public.user_settings for update to authenticated
  using (user_id = public.me()) with check (user_id = public.me());

create policy "own channels" on public.channel_identities for select to authenticated using (user_id = public.me());

create policy "my friendships" on public.friendships for select to authenticated
  using (public.me() in (user_a, user_b) and (status <> 'blocked' or blocked_by = public.me()));

create policy "my invites" on public.invites for select to authenticated using (inviter_id = public.me());

create policy "own lists" on public.friend_lists for all to authenticated
  using (owner_id = public.me()) with check (owner_id = public.me());

create policy "own list members" on public.friend_list_members for all to authenticated
  using (exists (select 1 from public.friend_lists l where l.id = list_id and l.owner_id = public.me()))
  with check (exists (select 1 from public.friend_lists l where l.id = list_id and l.owner_id = public.me()));

-- Presence is live only: friends see a session for 10 minutes after it starts, never a history.
create policy "own sessions and live friend presence" on public.brush_sessions for select to authenticated
  using (
    user_id = public.me()
    or (started_at > now() - interval '10 minutes' and public.in_presence_audience(user_id, public.me()))
  );

-- FR-R8: a check-in is readable by its author and its recipients only.
create policy "own or received check-ins" on public.check_ins for select to authenticated
  using (
    user_id = public.me()
    or (status = 'delivered' and public.is_recipient(id, public.me()))
  );

-- Recipients see their own row only, so they never learn who else received a check-in (FR-R7).
create policy "own recipient rows or my check-in's recipients" on public.check_in_recipients for select to authenticated
  using (
    recipient_id = public.me()
    or public.check_in_author(check_in_id) = public.me()
  );

create policy "reactions I sent or received" on public.reactions for select to authenticated
  using (from_user = public.me() or to_user = public.me());

-- ── Grants ────────────────────────────────────────────────────────────────────────────────────

alter table public.friend_lists alter column owner_id set default public.me();

revoke all on all tables in schema public from anon;
revoke insert, update, delete on all tables in schema public from authenticated;
grant update (display_name) on public.profiles to authenticated;
grant update (timezone, brush_times, quiet_start, quiet_end, invisible, dominant_hand, preferred_channel,
              default_list_id, presence_list_id) on public.user_settings to authenticated;
grant insert (name), update (name), delete on public.friend_lists to authenticated;
grant insert, delete on public.friend_list_members to authenticated;
revoke all on public.outbound_messages from authenticated;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.me(), public.get_me(), public.complete_onboarding(text, text, text[]),
  public.export_my_data(), public.delete_my_account(),
  public.start_session(text), public.end_session(uuid),
  public.post_check_in(text, text, text, text, uuid, uuid[]),
  public.set_check_in_audience(uuid, text, uuid, uuid[], boolean),
  public.undo_check_in(uuid), public.delete_check_in(uuid), public.edit_check_in(uuid, text, text),
  public.get_feed(int), public.mark_seen(uuid[]), public.get_circle(),
  public.invite_friend(text, text), public.create_invite_link(), public.accept_invite(text),
  public.respond_to_friend(uuid, boolean), public.remove_friend(uuid), public.block_friend(uuid),
  public.send_reaction(uuid, text, text), public.run_due_jobs(),
  -- used inside RLS policies, so the calling role needs them
  public.are_friends(uuid, uuid), public.in_presence_audience(uuid, uuid),
  public.is_recipient(uuid, uuid), public.check_in_author(uuid)
to authenticated;
grant execute on function public.get_invite(text) to anon, authenticated;
grant execute on function
  public.claim_outbound(int), public.complete_outbound(bigint, boolean, text, text),
  public.agent_handle_inbound(text, text, text, text, text), public.run_due_jobs()
to service_role;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- ── Cron ──────────────────────────────────────────────────────────────────────────────────────

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('toothbrush-due-jobs', '5 seconds', 'select public.run_due_jobs()');
