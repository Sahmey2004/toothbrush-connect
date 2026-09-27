# Brushing reminders over iMessage — design

Date: 2026-09-27 · Status: approved in chat, awaiting spec review

## Goal

Help people build the habit. On Profile, each person can set an estimated time for their morning brush and their
night brush. Five minutes before each one, the agent texts them over iMessage with a link that opens `/start`, the
brushing page, where starting the 2:00 timer is one tap.

## Decisions (from the brainstorm)

- The link **opens `/start`**. Nothing starts automatically: brushing is one tap away, so an early or accidental tap
  doesn't start a session.
- The **database schedules reminders** (the existing 5 s `run_due_jobs` cron). The agent only sends them. That's
  how every other agent message works today.
- Reminders are **off by default**. Morning and night are switched on separately. Same time every day, in the
  person's local timezone.
- **Skip** a reminder if the person is brushing now or started a session in the last 30 minutes.
- **Ignore quiet hours**: the person picked the time.
- Only **verified, not-opted-out iMessage numbers** get reminders (Photon can only text numbers that texted in).
  They're sent **even if "Get friends' updates by" is "Only on this website"**. That setting is about friends'
  updates; a reminder is something the person asked for.
- A reminder still unsent **10 minutes** after it was queued is dropped, so an agent outage never sends a stale
  "brush in 5 minutes".

## 1. Database — migration `20260926000016_brush_reminders.sql`

### Settings

```sql
alter table public.user_settings
  add column morning_reminder time,   -- null = off
  add column night_reminder   time;   -- null = off
grant update (morning_reminder, night_reminder) on public.user_settings to authenticated;
```

The website saves them with the existing `api.updateSettings` (a direct `user_settings` update under RLS), together
with `timezone`, which is already updatable and validated by the `user_settings_check` trigger.

### Once-per-day log

```sql
create table public.brush_reminders (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  slot       text not null check (slot in ('morning', 'night')),
  local_date date not null,          -- the person's local date of the brush time
  queued     boolean not null,       -- false = skipped (already brushing)
  created_at timestamptz not null default now(),
  primary key (user_id, slot, local_date)
);
alter table public.brush_reminders enable row level security;  -- no policies: service role only
```

The primary key is what makes each reminder go out at most once, even when two `run_due_jobs` runs overlap.

### `enqueue_brush_reminders()`

A `security definer` function, called from `run_due_jobs()`. Each call:

1. **Finds due slots.** Every `(user, slot, time)` where the time is set, and the person has a verified
   (`verified_at is not null`), not opted out (`opted_out_at is null`) `imessage` row in `channel_identities`.
   A slot is due when `now()` is in `[brush_at − 5 min, brush_at)`, where

   ```sql
   brush_at = ((now() at time zone s.timezone)::date + k + t) at time zone s.timezone   -- k in (0, 1)
   ```

   Checking today (`k = 0`) and tomorrow (`k = 1`) covers brush times just after midnight: a 00:02 brush is
   reminded at 23:57 the day before. `local_date` is that occurrence's local date. Postgres handles DST.
2. **Logs** `(user_id, slot, local_date, queued)` with `on conflict do nothing`. If the row already existed,
   nothing else happens. `queued` is false when a `brush_sessions` row for the user is `active` or has
   `started_at > now() − 30 min`.
3. **Queues** the text for newly logged, `queued` rows. It inserts straight into `outbound_messages`
   (`kind = 'reminder'`, `channel = 'imessage'`, `address` = that verified number, `send_after = now()`), not
   through `enqueue_message`, which returns nothing for web-only people and applies quiet hours. Body:
   - morning: `[🌅 BRUSH TIME] Your morning brush is in 5 minutes.`
   - night: `[🌙 BRUSH TIME] Your night brush is in 5 minutes.`

`run_due_jobs()` is redefined (`create or replace`) from its current body in `20260926000004_agent_service.sql`, plus
a `perform public.enqueue_brush_reminders();` at the end. Each run scans `user_settings` rows that have a
reminder time set, which is trivial at current user numbers.

### Expiry — `claim_outbound()`

`claim_outbound()` is redefined from its current body in `20260926000002_functions.sql`, with one extra step
after stuck sends are put back to pending (so a reminder the agent died holding expires too) and before the
claim:

```sql
update public.outbound_messages set status = 'skipped', error = 'expired'
where status = 'pending' and kind = 'reminder' and created_at < now() - interval '10 minutes';
```

The existing opt-out skip and retry (3 attempts, 30 s apart) still apply.

Grants: `enqueue_brush_reminders()` is revoked from `public`, `anon` and `authenticated` (only the cron and
`run_due_jobs` call it).

## 2. Agent — message text and link

The format matches the other agent messages (FR-D3: label first, link last):

```
[🌙 BRUSH TIME] Your night brush is in 5 minutes.
Start brushing → https://<SITE_URL>/start
```

- `templates/messages.ts`: `renderReminder(body, link)` returns `` `${body}\nStart brushing → ${link}` ``, with the
  link checked by the existing `assertLink`.
- `agent/index.ts` `textFor`: a `case "reminder"` returns `renderReminder(m.body, links.page("/start"))`. The agent
  adds the link because only it knows `SITE_URL` (the same way presence messages get their link).
- Replies don't change: STOP turns off every text, reminders included (`claim_outbound` already skips opted-out
  addresses); START turns them back on.
- A tapped link opens `/start`. If the person is signed in on that phone's browser, they see "Start brushing". If
  they aren't, they land on `/`, and Google sign-in already sends signed-in people to `/start`.

## 3. Website — Profile panel

A new **"Brushing reminders"** panel in `pages/Profile.tsx`, right after "Your phone number", in the existing
`pop-set__panel` style:

```
Brushing reminders
🌅 Morning   [ on ]   [ 7:30 AM ]
🌙 Night     [ off]   [10:30 PM ]   (dimmed while off)
We'll text you 5 minutes before, with a link to start brushing.
Times are your local time (America/Chicago).
```

- Each row has an on/off switch (`role="switch"`, `aria-checked`) and a native `<input type="time">` (the iPhone
  wheel).
- Switching a row on fills in a suggested time (morning `07:30`, night `22:30`) and saves. Changing the time
  saves. Switching it off saves `null`. Success shows "Reminders saved" through the page's existing `ok`
  message.
- Every save sends `timezone: Intl.DateTimeFormat().resolvedOptions().timeZone` as well, so reminders follow where
  the person is now.
- **No verified number** (`me.phone` is null): the switches and time pickers are disabled, with the note "Add and
  verify your number above to get reminders."
- `types/api.ts` `Settings`: `morning_reminder: string | null; night_reminder: string | null;` (Postgres returns
  `"07:30:00"`; the UI shows and sends `HH:MM`). `get_me` already returns them: its latest definition (migration
  0006) builds `settings` from `to_jsonb(s) - 'user_id'`, so new columns come through without changes.
- Styles go in `styles/pop.css`, next to the other `pop-set__*` rules.

## 4. Edge cases

- **Changing a time after today's reminder already went out:** the new time applies from tomorrow (one per slot
  per local day). A change made before the 5-minute window applies today.
- **Setting a time less than 5 minutes away:** the reminder goes out on the next run, within about 5 s. That's
  acceptable.
- **Morning and night set to the same time:** both are sent. We don't special-case it.
- **A local time that doesn't exist on the spring-forward night** (e.g. 02:30): Postgres shifts it an hour.
  That's acceptable.
- **Account deleted:** `brush_reminders` cascades with `profiles`. The settings columns go with `user_settings`.

## 5. Testing

- **SQL suite** `backend/supabase/tests/brush_reminders.sql` (same style as `core_flow.sql`: one transaction,
  `pg_temp.check`, rolled back), against the local stack after `supabase db reset`. Cases:
  1. A time set 3 minutes from now (in a non-UTC timezone) queues exactly one `reminder` with the night/morning
     body and `send_after <= now()`.
  2. Running it again queues nothing more.
  3. It's queued during quiet hours (quiet hours covering now).
  4. A time 20 minutes away, or 1 minute ago, queues nothing.
  5. A session started 10 minutes ago logs `queued = false` and sends nothing.
  6. No verified number, or `opted_out_at` set: nothing.
  7. `preferred_channel = 'web'`: still queued to iMessage.
  8. A brush time at 00:02 local, with now at 23:59 local, is due and gets tomorrow's `local_date`.
  9. A pending reminder created 11 minutes ago is `skipped` / `expired` by `claim_outbound()`, and isn't returned.
  - Plus re-running `core_flow.sql` and `text_to_verify.sql`.
- **Agent** (vitest): `renderReminder` output, and `textFor` / `drain` sending a `reminder` with the `/start` link
  through the fake provider. `npm test` and `npm run build` in `backend/`.
- **Frontend:** `npm run build` (tsc + vite). 390px headless screenshots of the panel on, off, and with no phone.

## 6. Rollout

1. Merge to `submain`, then `main` (Vercel deploys the website).
2. Apply migration `0016` to the hosted Supabase project (`supabase db push`), **after asking**. Check
   `supabase migration list --linked` first.
3. Restart the agent with the new code (`AGENT_MODE=photon npx tsx --env-file=.env src/agent/main.ts`, wherever it
   runs).
4. README "Messaging agent" section: add a line about reminders.

## Out of scope

Different times on weekdays and weekends, reminders by text command ("remind me at 7"), sending "friends brushing
now" inside the reminder, and moving the existing presence link off the legacy `/brush` page.
