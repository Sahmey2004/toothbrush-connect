-- Brushing reminders: people set a morning and a night brush time on Profile. Five minutes before each, the
-- database queues an iMessage (kind 'reminder'), and the agent adds a link to /start
-- (docs/superpowers/specs/2026-09-27-brush-reminders-design.md).

alter table public.user_settings
  add column morning_reminder time,  -- null = off
  add column night_reminder   time;  -- null = off
grant update (morning_reminder, night_reminder) on public.user_settings to authenticated;

-- One row per person, slot and local day, so a reminder is handled at most once, even if runs overlap.
create table public.brush_reminders (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  slot       text not null check (slot in ('morning', 'night')),
  local_date date not null,     -- the person's local date of the brush time
  queued     boolean not null,  -- false = skipped, they were already brushing
  created_at timestamptz not null default now(),
  primary key (user_id, slot, local_date)
);
alter table public.brush_reminders enable row level security;  -- no policies: service role only

-- Queue the reminders due at p_now: brush times 0–5 minutes away in each person's timezone, for people with a
-- verified iMessage number that hasn't opted out. Quiet hours and "Only on this website" don't apply: the person
-- asked for these. Skipped (but logged) if they're brushing or started in the last 30 minutes. Today and tomorrow
-- are both checked, so a 00:02 brush is reminded at 23:57 the day before. Returns how many were queued.
create function public.enqueue_brush_reminders(p_now timestamptz default now()) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_n int;
begin
  with slots as (
    select s.user_id, s.timezone, x.slot, x.t
    from public.user_settings s
    cross join lateral (values ('morning', s.morning_reminder), ('night', s.night_reminder)) x(slot, t)
    where x.t is not null
  ),
  due as (
    select sl.user_id, sl.slot, d.local_date, ci.address
    from slots sl
    cross join lateral (
      select (p_now at time zone sl.timezone)::date + k as local_date from generate_series(0, 1) k
    ) d
    join lateral (
      select c.address from public.channel_identities c
      where c.user_id = sl.user_id and c.channel = 'imessage'
        and c.verified_at is not null and c.opted_out_at is null
      order by c.verified_at desc
      limit 1
    ) ci on true
    where p_now >= ((d.local_date + sl.t) at time zone sl.timezone) - interval '5 minutes'
      and p_now <  ((d.local_date + sl.t) at time zone sl.timezone)
  ),
  logged as (
    insert into public.brush_reminders (user_id, slot, local_date, queued)
    select due.user_id, due.slot, due.local_date,
           not exists (
             select 1 from public.brush_sessions b
             where b.user_id = due.user_id
               and (b.status = 'active' or b.started_at > p_now - interval '30 minutes')
           )
    from due
    on conflict do nothing
    returning user_id, slot, local_date, queued
  )
  insert into public.outbound_messages (user_id, channel, address, kind, body)
  select l.user_id, 'imessage', due.address, 'reminder',
         case l.slot when 'morning' then '[🌅 BRUSH TIME] Your morning brush is in 5 minutes.'
                     else '[🌙 BRUSH TIME] Your night brush is in 5 minutes.' end
  from logged l join due using (user_id, slot, local_date)
  where l.queued;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke execute on function public.enqueue_brush_reminders(timestamptz) from public, anon, authenticated;

-- run_due_jobs as in 20260926000004_agent_service.sql, plus the reminders.
create or replace function public.run_due_jobs() returns void
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

  perform public.enqueue_brush_reminders();
end $$;

-- claim_outbound as in 20260926000002_functions.sql, plus: a reminder still unsent 10 minutes after it was queued
-- is dropped, so an agent outage never sends a stale "brush in 5 minutes".
create or replace function public.claim_outbound(p_limit int default 50) returns setof public.outbound_messages
language plpgsql security definer set search_path = '' as $$
begin
  update public.outbound_messages set status = 'skipped', error = 'expired'
  where status = 'pending' and kind = 'reminder' and created_at < now() - interval '10 minutes';

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
