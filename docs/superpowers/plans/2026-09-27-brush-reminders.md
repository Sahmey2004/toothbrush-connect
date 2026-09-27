# Brushing Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** People set a morning and a night brush time on Profile. Five minutes before each, they get an iMessage
with a link to `/start`.

**Architecture:** The database decides what to send. `run_due_jobs()` (pg_cron, every 5 s) calls a new
`enqueue_brush_reminders()`. That function logs each due reminder once per person, slot and local day, then
queues a `kind = 'reminder'` row in `outbound_messages`. The Node agent already drains that outbox. It gains a
`reminder` case that appends `Start brushing → <SITE_URL>/start`. The website saves two new `user_settings`
columns from a new Profile panel.

**Tech Stack:** Postgres / Supabase (plpgsql, pg_cron), TypeScript agent (vitest), React 19 + Vite frontend
(vitest).

**Spec:** `docs/superpowers/specs/2026-09-27-brush-reminders-design.md`

## Global Constraints

- Migration file: `backend/supabase/migrations/20260926000016_brush_reminders.sql` (the next free number after
  0015).
- New settings columns: `user_settings.morning_reminder time` and `user_settings.night_reminder time`. `null`
  means off.
- Outbox kind: `'reminder'`. Bodies, exactly:
  - morning: `[🌅 BRUSH TIME] Your morning brush is in 5 minutes.`
  - night: `[🌙 BRUSH TIME] Your night brush is in 5 minutes.`
- Final text: `<body>\nStart brushing → <SITE_URL>/start`.
- Due window: `[brush_at − 5 minutes, brush_at)` in the person's `user_settings.timezone`. Once per
  `(user, slot, local_date)`.
- Skip (log with `queued = false`) when a session is `active` or `started_at > p_now − 30 minutes`.
- Only verified (`verified_at is not null`), not opted out (`opted_out_at is null`) `imessage` rows in
  `channel_identities`. Ignore quiet hours and `preferred_channel`.
- `claim_outbound()` marks pending reminders older than 10 minutes (`created_at`) `skipped`, with error `expired`.
- Suggested times when switching on: morning `07:30`, night `22:30`. Every save sends the browser timezone
  (`Intl.DateTimeFormat().resolvedOptions().timeZone`).
- UI copy: panel title `Brushing reminders`; note `We'll text you 5 minutes before, with a link to start
  brushing. Times are your local time (<tz>).`; without a verified number, `Add and verify your number above to
  get reminders.`; success `Reminders saved`.
- Code style: match the surrounding files. SQL: lowercase keywords, `security definer set search_path = ''`,
  schema-qualified names, a short comment above each object. TS: double quotes, semicolons, short "why"
  comments.

## Review Focus

1. **Window edges:** a run at exactly `brush_at − 5:00` must queue, and a run at exactly `brush_at` must not. Test
   in Task 1 (Step 1, "edges").
2. **Daylight saving day:** on 2026-11-01 (US fall back), a 07:30 Chicago reminder goes out at 07:27 local
   (13:27 UTC), not an hour off. Test in Task 1 (Step 1, "DST").
3. **Account timezone still `UTC`** (default, or someone who moved): saving any reminder must store this device's
   timezone. Test in Task 3 (Step 1, `reminderPatch` defaults to the device timezone).
4. **Postgres returns `"07:30:00"`** but `<input type="time">` needs `"07:30"`. The round trip must not blank the
   field. Test in Task 3 (Step 1, `toInputTime`).
5. **Phone removed after reminders were switched on:** nothing is queued or logged. The times stay saved and the
   Profile switches are disabled. Test in Task 1 (Step 1, "phone removed"). Screenshot in Task 3 (Step 9).

---

### Task 1: Database — settings columns, reminder log, `enqueue_brush_reminders`, expiry

**Files:**
- Create: `backend/supabase/migrations/20260926000016_brush_reminders.sql`
- Create: `backend/supabase/tests/brush_reminders.sql`

**Interfaces:**
- Consumes: the existing `run_due_jobs()` body (`20260926000004_agent_service.sql`), the `claim_outbound(int)`
  body (`20260926000002_functions.sql:811-831`), `set_my_phone('')` (removes the number, migration 0015), and
  `public.start_session`. Nothing from other tasks.
- Produces: columns `user_settings.morning_reminder` / `night_reminder` (`time`, nullable, updatable by
  `authenticated`), table `public.brush_reminders(user_id, slot, local_date, queued, created_at)`, and
  `public.enqueue_brush_reminders(p_now timestamptz default now()) returns int`. Outbox rows `kind = 'reminder'`,
  `channel = 'imessage'`, bodies as in Global Constraints. Task 2 renders these; Task 3 saves the columns.

Local database: `postgresql://postgres:postgres@127.0.0.1:54322/postgres` (from `supabase start` in `backend/`;
already running, at migration 0015).

- [ ] **Step 1: Write the failing SQL test**

Create `backend/supabase/tests/brush_reminders.sql`:

```sql
-- Brushing reminders (migration 0016): 5 minutes before someone's morning or night brush time, the database queues
-- one iMessage (kind 'reminder'); the agent adds the /start link. Run with:
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/brush_reminders.sql
begin;
\set QUIET on
create temp table ids (name text primary key, auth uuid, profile uuid);
grant all on ids to authenticated;

-- Priya and Sam sign in by phone, so each has a verified iMessage number. Gia signs in with Google and has none.
insert into auth.users (id, phone, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000c1', '15550001001', null, 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000c2', '15550001002', null, 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000c3', null, 'gia@example.com', 'authenticated', 'authenticated');
insert into ids select n, u, (select id from public.profiles where auth_user_id = u)
from (values ('priya', '00000000-0000-0000-0000-0000000000c1'::uuid),
             ('sam',   '00000000-0000-0000-0000-0000000000c2'::uuid),
             ('gia',   '00000000-0000-0000-0000-0000000000c3'::uuid)) v(n, u);

create function pg_temp.as_user(n text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', (select auth from ids where name = n), 'role', 'authenticated')::text, true);
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
create function pg_temp.pid(n text) returns uuid language sql as $$ select profile from ids where name = n $$;
-- Reminder messages queued for someone, oldest first.
create function pg_temp.reminders(n text) returns setof public.outbound_messages language sql as $$
  select * from public.outbound_messages where kind = 'reminder' and user_id = pg_temp.pid(n) order by id
$$;
create function pg_temp.n_reminders(n text) returns bigint language sql as $$
  select count(*) from pg_temp.reminders(n)
$$;

-- The website saves reminder times the way Profile does: a direct user_settings update, with the browser's timezone.
select pg_temp.as_user('priya');
update public.user_settings set timezone = 'America/Chicago', morning_reminder = '07:30', night_reminder = '22:00'
where user_id = pg_temp.pid('priya');
select pg_temp.check((public.get_me())#>>'{settings,night_reminder}' = '22:00:00', 'Priya saved her reminder times');
select pg_temp.check(pg_temp.raises($$select public.enqueue_brush_reminders()$$, 'permission denied'),
  'the website cannot queue reminders itself');
select pg_temp.as_user('sam');
update public.user_settings set timezone = 'America/New_York', night_reminder = '23:30', preferred_channel = 'web'
where user_id = pg_temp.pid('sam');
select pg_temp.as_user('gia');
update public.user_settings set timezone = 'America/Chicago', night_reminder = '22:00'
where user_id = pg_temp.pid('gia');
reset role;

-- Edges: 6 minutes early, nothing. Exactly 5 minutes before, one reminder.
select public.enqueue_brush_reminders('2026-10-01 21:54 America/Chicago');
select pg_temp.check(pg_temp.n_reminders('priya') = 0, 'nothing 6 minutes before');
select public.enqueue_brush_reminders('2026-10-01 21:55 America/Chicago');
select pg_temp.check(pg_temp.n_reminders('priya') = 1, 'queued exactly 5 minutes before');
select pg_temp.check((select body from pg_temp.reminders('priya')) = '[🌙 BRUSH TIME] Your night brush is in 5 minutes.',
  'night reminder text');
select pg_temp.check((select channel = 'imessage' and address = '+15550001001' and status = 'pending' and send_after <= now()
  from pg_temp.reminders('priya')), 'to Priya''s verified iMessage number, due now');

-- Later runs the same evening add nothing.
select public.enqueue_brush_reminders('2026-10-01 21:57 America/Chicago');
select public.enqueue_brush_reminders('2026-10-01 21:59:59 America/Chicago');
select pg_temp.check(pg_temp.n_reminders('priya') = 1, 'one reminder per night');

-- Edges: once the brush time arrives, it's too late to remind.
select public.enqueue_brush_reminders('2026-10-02 22:00 America/Chicago');
select pg_temp.check(pg_temp.n_reminders('priya') = 1, 'no reminder once the brush time has arrived');
select pg_temp.check(not exists (select 1 from public.brush_reminders where user_id = pg_temp.pid('priya') and local_date = '2026-10-02' and slot = 'night'),
  'and nothing logged for it');

-- The morning one has its own text, and the next night comes again.
select public.enqueue_brush_reminders('2026-10-03 07:26 America/Chicago');
select pg_temp.check((select body from pg_temp.reminders('priya') order by id desc limit 1)
  = '[🌅 BRUSH TIME] Your morning brush is in 5 minutes.', 'morning reminder text');
select public.enqueue_brush_reminders('2026-10-03 21:58 America/Chicago');
select pg_temp.check(pg_temp.n_reminders('priya') = 3, 'a new reminder the next day');

-- Quiet hours (default 23:00–07:00) and "Only on this website" don't hold a reminder back.
select public.enqueue_brush_reminders('2026-10-01 23:27 America/New_York');
select pg_temp.check((select count(*) = 1 and bool_and(send_after <= now() and channel = 'imessage') from pg_temp.reminders('sam')),
  'sent during quiet hours, and to a website-only person');

-- No verified number: nothing queued or logged.
select public.enqueue_brush_reminders('2026-10-01 21:57 America/Chicago');
select pg_temp.check(pg_temp.n_reminders('gia') = 0, 'no reminder without a verified number');
select pg_temp.check(not exists (select 1 from public.brush_reminders where user_id = pg_temp.pid('gia')), 'nothing logged for Gia');

-- Brushing now: logged as handled, not texted.
insert into public.brush_sessions (user_id, status) values (pg_temp.pid('priya'), 'active');
select public.enqueue_brush_reminders('2026-10-04 07:27 America/Chicago');
select pg_temp.check(pg_temp.n_reminders('priya') = 3, 'no reminder while brushing');
select pg_temp.check((select not queued from public.brush_reminders where user_id = pg_temp.pid('priya') and slot = 'morning' and local_date = '2026-10-04'),
  'logged as skipped');
delete from public.brush_sessions where user_id = pg_temp.pid('priya');

-- Started 22 minutes ago: skipped. Started 42 minutes ago: reminded.
insert into public.brush_sessions (user_id, status, started_at, ends_at, ended_at) values
  (pg_temp.pid('priya'), 'completed', '2026-10-05 07:05 America/Chicago', '2026-10-05 07:07 America/Chicago', '2026-10-05 07:07 America/Chicago');
select public.enqueue_brush_reminders('2026-10-05 07:27 America/Chicago');
select pg_temp.check(pg_temp.n_reminders('priya') = 3, 'no reminder 22 minutes after a brush');
insert into public.brush_sessions (user_id, status, started_at, ends_at, ended_at) values
  (pg_temp.pid('priya'), 'completed', '2026-10-06 06:45 America/Chicago', '2026-10-06 06:47 America/Chicago', '2026-10-06 06:47 America/Chicago');
select public.enqueue_brush_reminders('2026-10-06 07:27 America/Chicago');
select pg_temp.check(pg_temp.n_reminders('priya') = 4, 'reminded 42 minutes after a brush');

-- A 00:02 brush is reminded at 23:59 the day before, logged for the brush's own date.
update public.user_settings set night_reminder = '00:02' where user_id = pg_temp.pid('priya');
select public.enqueue_brush_reminders('2026-10-07 23:59 America/Chicago');
select pg_temp.check(exists (select 1 from public.brush_reminders where user_id = pg_temp.pid('priya') and slot = 'night' and local_date = '2026-10-08' and queued),
  'a 00:02 brush is reminded at 23:59 the day before');
select pg_temp.check(pg_temp.n_reminders('priya') = 5, 'and texted');

-- DST: 2026-11-01 is fall back in Chicago. 07:30 CST is 13:30 UTC, so 12:27 UTC is an hour early and 13:27 UTC is right.
select public.enqueue_brush_reminders('2026-11-01 12:27+00');
select pg_temp.check(pg_temp.n_reminders('priya') = 5, 'DST: not an hour early');
select public.enqueue_brush_reminders('2026-11-01 13:27+00');
select pg_temp.check(pg_temp.n_reminders('priya') = 6, 'DST: at 07:27 local time');

-- STOP: nothing while opted out.
update public.channel_identities set opted_out_at = now() where user_id = pg_temp.pid('priya');
select public.enqueue_brush_reminders('2026-11-02 07:27 America/Chicago');
select pg_temp.check(pg_temp.n_reminders('priya') = 6, 'no reminder after STOP');
update public.channel_identities set opted_out_at = null where user_id = pg_temp.pid('priya');

-- run_due_jobs (the 5 s cron) queues reminders too. Sam's morning time (unused so far) is 3 minutes from the real clock.
update public.user_settings set morning_reminder = ((now() at time zone 'America/New_York') + interval '3 minutes')::time
where user_id = pg_temp.pid('sam');
select public.run_due_jobs();
select pg_temp.check(exists (select 1 from pg_temp.reminders('sam') where body like '%morning brush%'), 'run_due_jobs queues due reminders');

-- Expiry: a reminder the agent didn't send within 10 minutes is dropped, not sent late. A newer one still goes.
update public.outbound_messages set created_at = now() - interval '11 minutes'
where id = (select id from pg_temp.reminders('priya') limit 1);
update public.outbound_messages set created_at = now() - interval '1 minute'
where id = (select id from pg_temp.reminders('priya') offset 1 limit 1);
create temp table claimed as select * from public.claim_outbound(1000);
select pg_temp.check((select status = 'skipped' and error = 'expired' from pg_temp.reminders('priya') limit 1), 'an 11-minute-old reminder expires');
select pg_temp.check(not exists (select 1 from claimed where id = (select id from pg_temp.reminders('priya') limit 1)), 'and is not sent');
select pg_temp.check(exists (select 1 from claimed where id = (select id from pg_temp.reminders('priya') offset 1 limit 1)), 'a 1-minute-old reminder is sent');

-- Phone removed after reminders were switched on: the times stay, nothing is queued or logged.
select pg_temp.as_user('priya');
select public.set_my_phone('');
select pg_temp.check((public.get_me())#>>'{settings,morning_reminder}' = '07:30:00', 'times stay saved without a phone');
reset role;
select public.enqueue_brush_reminders('2026-11-03 07:27 America/Chicago');
select pg_temp.check(not exists (select 1 from public.brush_reminders where user_id = pg_temp.pid('priya') and local_date = '2026-11-03'),
  'phone removed: nothing logged or queued');

\echo 'all checks passed'
rollback;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/brush_reminders.sql`
Expected: FAIL with `ERROR:  column "morning_reminder" of relation "user_settings" does not exist`.

- [ ] **Step 3: Write the migration**

Create `backend/supabase/migrations/20260926000016_brush_reminders.sql`:

```sql
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
```

- [ ] **Step 4: Apply the migration to the local stack and run the test**

Run: `cd backend && supabase migration up && psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/brush_reminders.sql`
Expected: `Applying migration 20260926000016_brush_reminders.sql...`, then only `NOTICE:  ok: …` lines and
`all checks passed`.

- [ ] **Step 5: Re-run the existing SQL suites**

Run: `cd backend && for f in core_flow text_to_verify; do psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/$f.sql 2>&1 | tail -1; done`
Expected: two lines of `all checks passed`, or the last `ok:` line if a suite has no `\echo` (no `ERROR` or
`FAILED` anywhere).

- [ ] **Step 6: Commit**

```bash
git add backend/supabase/migrations/20260926000016_brush_reminders.sql backend/supabase/tests/brush_reminders.sql
git commit -m "Brushing reminders: the database queues an iMessage 5 minutes before each brush time"
```

---

### Task 2: Agent — render reminders with the `/start` link

**Files:**
- Modify: `backend/src/agent/templates/labels.ts` (`LabelSpec` union and `FIXED`, lines 7-30)
- Modify: `backend/src/agent/templates/messages.ts` (add `renderReminder` after `renderBrushingNow`, ~line 86)
- Modify: `backend/src/agent/index.ts` (import, and `textFor` switch, ~lines 18 and 31-41)
- Test: `backend/src/agent/templates/messages.test.ts`, `backend/src/agent/index.test.ts`

**Interfaces:**
- Consumes (Task 1): outbox rows `kind = 'reminder'` with body `[🌅 BRUSH TIME] Your morning brush is in 5
  minutes.` or `[🌙 BRUSH TIME] Your night brush is in 5 minutes.`
- Produces: `renderReminder(body: string, link: string): string` in `templates/messages.ts`, and label kinds
  `brush_time_morning` (`🌅 BRUSH TIME`) and `brush_time_night` (`🌙 BRUSH TIME`) in `labels.ts`.

- [ ] **Step 1: Write the failing tests**

In `backend/src/agent/templates/messages.test.ts`, add `renderReminder,` to the import list from `./messages.js`
(alphabetical, after `renderReply,`). Add these two entries to `samples`, after `["welcome", renderWelcome(LINK)],`:

```ts
  ["morning reminder", renderReminder("[🌅 BRUSH TIME] Your morning brush is in 5 minutes.", LINK)],
  ["night reminder", renderReminder("[🌙 BRUSH TIME] Your night brush is in 5 minutes.", LINK)],
```

and this test at the end of `describe("messages", …)`:

```ts
  it("add the Start link to the reminder the database wrote", () => {
    expect(renderReminder("[🌙 BRUSH TIME] Your night brush is in 5 minutes.", LINK)).toBe(
      `[🌙 BRUSH TIME] Your night brush is in 5 minutes.\nStart brushing → ${LINK}`,
    );
  });
```

In `backend/src/agent/index.test.ts`, add after the `"adds the Join link to brushing-now messages"` test:

```ts
  it("adds the Start link to brushing reminders", async () => {
    const { agent, sent, enqueue } = setup();
    const body = "[🌙 BRUSH TIME] Your night brush is in 5 minutes.";
    enqueue({ userId: "u", channel: "imessage", address: SAM, kind: "reminder", body, checkInId: null });
    await agent.drain();
    expect(sent[0].text).toBe(`${body}\nStart brushing → http://localhost:5173/start`);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx vitest run src/agent/templates/messages.test.ts src/agent/index.test.ts`
Expected: FAIL. `renderReminder` is not exported (`renderReminder is not a function`), and the agent test gets the
body without the link.

- [ ] **Step 3: Add the labels**

In `backend/src/agent/templates/labels.ts`, extend `LabelSpec` (after `| { kind: "post_on_web" }`, replacing its
trailing `;`):

```ts
  | { kind: "post_on_web" }
  // brushing reminders; the database writes these (enqueue_brush_reminders, migration 0016)
  | { kind: "brush_time_morning" }
  | { kind: "brush_time_night" };
```

and add to `FIXED` after `post_on_web: "ℹ️ POST ON THE WEB",`:

```ts
  brush_time_morning: "🌅 BRUSH TIME",
  brush_time_night: "🌙 BRUSH TIME",
```

- [ ] **Step 4: Add `renderReminder`**

In `backend/src/agent/templates/messages.ts`, after `renderBrushingNow`:

```ts
// [🌙 BRUSH TIME] Your night brush is in 5 minutes.
// Start brushing → https://…/start
// The database writes the first line (enqueue_brush_reminders, migration 0016); this adds the link.
export function renderReminder(body: string, link: string): string {
  return `${clean(body, 200)}\nStart brushing → ${assertLink(link)}`;
}
```

- [ ] **Step 5: Use it in the agent**

In `backend/src/agent/index.ts`, change the templates import to:

```ts
import { renderReminder, renderUpdate, renderWelcome } from "./templates/messages.js";
```

and in `textFor`, add before `default:`:

```ts
      case "reminder":
        return renderReminder(m.body, links.page("/start"));
```

Update the comment above `textFor` to: `// Check-ins are re-rendered with our templates; brushing-now gets its Join link and reminders their Start
  // link (FR-D3: label first, link last); other kinds go out as the database wrote them.`

- [ ] **Step 6: Run the tests and the build**

Run: `cd backend && npm test && npm run build`
Expected: all vitest suites pass (the previous count plus the 4 new cases: 2 lint samples, 1 message test, 1
agent test). `tsc` exits 0.

- [ ] **Step 7: Commit**

```bash
git add backend/src/agent/templates/labels.ts backend/src/agent/templates/messages.ts backend/src/agent/index.ts backend/src/agent/templates/messages.test.ts backend/src/agent/index.test.ts
git commit -m "Agent: send brushing reminders with a Start brushing link to /start"
```

---

### Task 3: Website — "Brushing reminders" panel on Profile

**Files:**
- Modify: `frontend/src/types/api.ts` (`Settings`, lines 8-19)
- Create: `frontend/src/lib/reminders.ts`
- Create: `frontend/src/lib/reminders.test.ts`
- Create: `frontend/src/components/profile/BrushReminders.tsx`
- Modify: `frontend/src/pages/Profile.tsx` (import; render the panel after the "Your phone number" `</section>`)
- Modify: `frontend/src/styles/pop.css` (append after `.pop-set__err`, ~line 845)

**Interfaces:**
- Consumes (Task 1): `user_settings.morning_reminder` / `night_reminder`, returned by `get_me` as `"HH:MM:SS"`
  strings or `null`, and updatable through the existing
  `api.updateSettings(patch: Partial<Omit<Settings, "onboarded_at">>, userId)`.
- Produces: `Settings.morning_reminder` / `night_reminder: string | null`;
  `reminderPatch(key, time, timezone?) → Partial<Settings>`; `toInputTime(t) → string`; `REMINDER_SLOTS`; and
  the `<BrushReminders settings hasPhone onSave />` component.

- [ ] **Step 1: Write the failing unit test**

Create `frontend/src/lib/reminders.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { REMINDER_SLOTS, reminderPatch, toInputTime } from "./reminders";

describe("toInputTime", () => {
  it("drops the seconds Postgres adds", () => expect(toInputTime("07:30:00")).toBe("07:30"));
  it("keeps HH:MM as it is", () => expect(toInputTime("22:05")).toBe("22:05"));
  it("is empty when the reminder is off", () => expect(toInputTime(null)).toBe(""));
});

describe("reminderPatch", () => {
  it("saves the time with the timezone", () => {
    expect(reminderPatch("night_reminder", "22:30", "America/Chicago")).toEqual({
      night_reminder: "22:30",
      timezone: "America/Chicago",
    });
  });

  it("switches a slot off with null", () => {
    expect(reminderPatch("morning_reminder", null, "Asia/Kolkata")).toEqual({
      morning_reminder: null,
      timezone: "Asia/Kolkata",
    });
  });

  it("defaults to this device's timezone, so an account still on UTC gets fixed", () => {
    expect(reminderPatch("morning_reminder", "07:30").timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
});

describe("REMINDER_SLOTS", () => {
  it("suggest 7:30 AM and 10:30 PM", () => {
    expect(REMINDER_SLOTS.map((s) => [s.key, s.suggested])).toEqual([
      ["morning_reminder", "07:30"],
      ["night_reminder", "22:30"],
    ]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/lib/reminders.test.ts`
Expected: FAIL with `Failed to resolve import "./reminders"`.

- [ ] **Step 3: Add the settings fields**

In `frontend/src/types/api.ts`, add to `Settings` after `presence_list_id: string | null;`:

```ts
  morning_reminder: string | null; // "07:30:00"; null = off. Texted 5 minutes before (migration 0016)
  night_reminder: string | null;
```

- [ ] **Step 4: Write `lib/reminders.ts`**

Create `frontend/src/lib/reminders.ts`:

```ts
// Brushing reminders (Profile): the agent texts 5 minutes before each time that's switched on (migration 0016).
import type { Settings } from "../types/api";

export type ReminderKey = "morning_reminder" | "night_reminder";

export const REMINDER_SLOTS: { key: ReminderKey; label: string; emoji: string; suggested: string }[] = [
  { key: "morning_reminder", label: "Morning", emoji: "🌅", suggested: "07:30" },
  { key: "night_reminder", label: "Night", emoji: "🌙", suggested: "22:30" },
];

// Postgres sends "07:30:00"; <input type="time"> wants "07:30".
export const toInputTime = (t: string | null): string => (t ? t.slice(0, 5) : "");

// One slot's time ("HH:MM", or null to switch it off), saved with this device's timezone, so reminders follow
// where the person is now.
export function reminderPatch(
  key: ReminderKey,
  time: string | null,
  timezone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): Partial<Settings> {
  return key === "morning_reminder" ? { morning_reminder: time, timezone } : { night_reminder: time, timezone };
}
```

- [ ] **Step 5: Run the unit test**

Run: `cd frontend && npx vitest run src/lib/reminders.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Write the panel component**

Create `frontend/src/components/profile/BrushReminders.tsx`:

```tsx
import { useEffect, useState } from "react";
import { REMINDER_SLOTS, reminderPatch, toInputTime } from "../../lib/reminders";
import type { Settings } from "../../types/api";

type Slot = (typeof REMINDER_SLOTS)[number];

// Profile panel: a morning and a night brush time. The agent texts 5 minutes before each one that's on, with a link
// to /start. Needs a verified number; `onSave` is Profile's save (it shows "Reminders saved" or the error).
export function BrushReminders({ settings, hasPhone, onSave }: {
  settings: Settings;
  hasPhone: boolean;
  onSave: (patch: Partial<Settings>) => Promise<boolean>;
}) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <section className="pop-set__panel" aria-labelledby="reminders-title">
      <h2 className="pop-set__panel-title" id="reminders-title">Brushing reminders</h2>
      {REMINDER_SLOTS.map((slot) => (
        <ReminderRow key={slot.key} slot={slot} value={settings[slot.key]} disabled={!hasPhone}
          onSave={(time) => onSave(reminderPatch(slot.key, time, timezone))} />
      ))}
      <p className="pop-set__meta">
        {hasPhone
          ? `We'll text you 5 minutes before, with a link to start brushing. Times are your local time (${timezone}).`
          : "Add and verify your number above to get reminders."}
      </p>
    </section>
  );
}

// One slot: the switch saves the shown time (or null); a changed time is saved when the picker closes.
function ReminderRow({ slot, value, disabled, onSave }: {
  slot: Slot;
  value: string | null;
  disabled: boolean;
  onSave: (time: string | null) => Promise<boolean>;
}) {
  const on = value != null; // undefined too: a database without migration 0016 yet
  const [time, setTime] = useState(toInputTime(value) || slot.suggested);
  useEffect(() => { if (value) setTime(toInputTime(value)); }, [value]);
  const id = `reminder-${slot.key}`;

  return (
    <div className={`pop-rem${on ? "" : " is-off"}`}>
      <label className="pop-rem__name" htmlFor={id}><span aria-hidden="true">{slot.emoji}</span> {slot.label}</label>
      <button type="button" role="switch" aria-checked={on} aria-label={`${slot.label} reminder`}
        className="pop-rem__switch" disabled={disabled} onClick={() => onSave(on ? null : time || slot.suggested)} />
      <input id={id} type="time" className="pop-set__input pop-rem__time" value={time} required
        disabled={disabled || !on}
        onChange={(e) => setTime(e.target.value)}
        onBlur={() => { if (on && time && time !== toInputTime(value)) onSave(time); }} />
    </div>
  );
}
```

- [ ] **Step 7: Put it on Profile**

In `frontend/src/pages/Profile.tsx`, add the import after the `usePhoneVerification` import:

```tsx
import { BrushReminders } from "../components/profile/BrushReminders";
```

and render it between the "Your phone number" `</section>` and the `<section>` titled "Get friends' updates by":

```tsx
        <BrushReminders settings={s} hasPhone={!!me.phone}
          onSave={(patch) => save(() => api.updateSettings(patch, me.id), "Reminders")} />
```

- [ ] **Step 8: Add the styles**

Append to the Profile / settings block in `frontend/src/styles/pop.css`, after `.pop-set__err { … }`:

```css
/* Brushing reminders: name · switch · time, one row per slot */
.pop-rem { display: grid; grid-template-columns: 1fr auto 128px; gap: 12px; align-items: center; }
.pop-rem__name { font-size: 16px; font-weight: 800; color: var(--ink); }
.pop-rem__time { height: 46px; padding: 0 10px; }
.pop-rem.is-off .pop-rem__time { opacity: 0.45; }
.pop-rem__switch {
  position: relative;
  width: 52px;
  height: 32px;
  border: 0;
  border-radius: 999px;
  background: #d9dce1;
  cursor: pointer;
  transition: background-color 150ms ease;
}
.pop-rem__switch::after {
  content: "";
  position: absolute;
  top: 3px;
  left: 3px;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  transition: transform 150ms ease;
}
.pop-rem__switch[aria-checked="true"] { background: var(--aqua); }
.pop-rem__switch[aria-checked="true"]::after { transform: translateX(20px); }
.pop-rem__switch:disabled { cursor: default; opacity: 0.5; }
.pop-rem__switch:focus-visible { outline: 3px solid var(--aqua); outline-offset: 2px; }
```

- [ ] **Step 9: Build and check it on a phone-sized screen**

Run: `cd frontend && npm test && npm run build`
Expected: vitest passes the 8 reminder tests; `tsc` and `vite build` succeed.

Then take screenshots at 390×844 with headless Chrome over CDP (see memory `verify-frontend-headless`). Use a
static harness in the session scratchpad that links the built `dist/assets/index-*.css` and repeats the panel's
markup in three states:
1. morning on at 07:30, night off
2. both on
3. no phone (switches `disabled`, the "Add and verify…" note)

Check that `document.documentElement.scrollWidth === innerWidth` (no sideways overflow), the switch knob sits
right and aqua when on, and a row that's off has a dimmed time.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/types/api.ts frontend/src/lib/reminders.ts frontend/src/lib/reminders.test.ts frontend/src/components/profile/BrushReminders.tsx frontend/src/pages/Profile.tsx frontend/src/styles/pop.css
git commit -m "Profile: set morning and night brush times for iMessage reminders"
```

---

### Task 4: README and rollout

**Files:**
- Modify: `README.md` ("Messaging agent" section, ~line 67; tests line, ~line 101)

**Interfaces:**
- Consumes: everything above.
- Produces: docs, and the feature live on the hosted project.

- [ ] **Step 1: Document it**

In `README.md`, in the "Messaging agent" section, change `(check-in deliveries, invites, brushing-now,
reactions)` to `(check-in deliveries, invites, brushing-now, reactions, brushing reminders)`. Then add this
paragraph after the section's first paragraph:

```markdown
**Brushing reminders.** People set a morning and a night brush time on Profile (`user_settings.morning_reminder` /
`night_reminder`, in their `timezone`). Every 5 s, `run_due_jobs` calls `enqueue_brush_reminders()`, which queues a
`reminder` 5 minutes before each time (once per slot per local day, logged in `brush_reminders`) to the person's
verified iMessage number, ignoring quiet hours. It skips people who are brushing or brushed in the last 30 minutes.
The agent adds `Start brushing → <SITE_URL>/start`. `claim_outbound` drops reminders still unsent after 10 minutes.
```

In the tests line, add `brush_reminders.sql` next to the other SQL suites if they're listed by name.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "README: brushing reminders"
```

- [ ] **Step 3: Full verification before shipping**

Run: `cd backend && npm test && npm run build && psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/brush_reminders.sql | tail -1 && cd ../frontend && npm test && npm run build`
Expected: everything passes, and `all checks passed`.

- [ ] **Step 4: Ship (ask the user before each outward step)**

1. **Ask**, then push: `git fetch origin && git merge origin/main` (if `main` moved), `git push origin
   submain`, `git push origin HEAD:main` (a fast-forward). Vercel deploys the website.
2. **Ask**, then apply to the hosted DB: `cd backend && supabase migration list --linked` (expect local 0016
   with no remote), `supabase db push --dry-run` (expect only `20260926000016_brush_reminders.sql`), then `supabase db push`.
   Afterwards re-run `supabase migration list --linked`. If it says an object already exists, stop and compare
   with `supabase db dump --linked --schema public` before repairing anything.
3. Tell the user to **restart the agent** with the new code (`AGENT_MODE=photon npx tsx --env-file=.env
   src/agent/main.ts`). Until it restarts, an older agent sends reminders without the link.
