# Toothbrush Connect

A website that turns the two minutes you spend brushing your teeth into a check-in with hometown friends. You post an update on the site; after the 30 s delivery hold, the backend's messaging agent sends it to each friend over iMessage via Photon Spectrum (WhatsApp / SMS as fallback).

```
website (post update) → Supabase RPC post_check_in → 30 s hold (pg_cron) → fan-out → outbound_messages
        → backend/src/agent (claim_outbound) → Photon Spectrum → iMessage
Photon stream (app.messages) → backend/src/agent → agent_handle_inbound (STOP, tapbacks, replies)
```

## Layout

```
frontend/   React + TypeScript + Vite website (installable PWA), talks to Supabase via supabase-js
  src/pages/        Landing, Login (Google), Onboarding, Invite, Brush, Circle, Timeline, Lists, Settings
  src/components/   timer, check-in (mood chips, audience sheet, hold banner), feed, presence, layout
  src/hooks/        countdown, session, presence (Supabase Realtime), wake lock, haptics
  src/api/client.ts Typed wrappers around the Supabase RPCs

backend/
  supabase/         Database and auth, hosted on Supabase (project: driftwatch, ref iltbflwrlybklasqpudg)
    migrations/       Schema, RLS policies and RPCs (check-ins, 30 s hold, fan-out, invites, lists, outbox)
    functions/        Edge functions from the first prototype (agent-dispatch, photon-webhook); nothing calls
                      them since migration 0004, the Node agent below takes over
    tests/            SQL smoke test for the core loop and audience enforcement
    config.toml       Auth: Google, phone sign-in (off), test numbers
  src/agent/        Photon Spectrum messaging agent (plan and Photon findings: docs/PLAN.md)
  src/              Remaining Node service stubs from the original scaffold (routes, services, jobs, realtime)

docs/       PRD.md (v3), PLAN.md (messaging agent)
```

## Setup

The website needs `frontend/.env.local` with the project URL and publishable key (see `frontend/.env.example`).

```sh
cd frontend && npm install && npm run dev        # http://localhost:5173
```

Sign-in is **Google** (Supabase Auth OAuth; the client ID and secret are set in the Supabase dashboard under
Authentication → Providers → Google). Google accounts start without a phone number; phone numbers, which
iMessage delivery needs, come later.

Phone sign-in is built but off. Turn it on with `VITE_ENABLE_PHONE_AUTH=true` once an SMS sender exists.
Test numbers `+1 555 000 0001` … `0004` use code `123456`.

### Database

Run the Supabase CLI from `backend/` (that is where `supabase/` lives). Schema changes go in a new file under
`backend/supabase/migrations/`, then:

```sh
cd backend
supabase link --project-ref iltbflwrlybklasqpudg   # once per checkout
supabase db push            # apply migrations to the hosted project
supabase config push        # apply auth settings from config.toml; review the diff first. Fill in the
                            # SUPABASE_AUTH_EXTERNAL_GOOGLE_* values in supabase/.env, or it will blank
                            # out the Google credentials set in the dashboard.
```

**Local stack** (optional, needs Docker): `cd backend && supabase start`, then point `frontend/.env.local` at
`http://127.0.0.1:54321` with the key from `supabase status`. Run the SQL smoke test with
`psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f backend/supabase/tests/core_flow.sql`.

### Messaging agent

The database queues every outgoing message (check-in deliveries, invites, brushing-now, reactions,
brushing reminders) in
`outbound_messages`. The agent (`backend/src/agent/`, a long-running Node process) claims them with
`claim_outbound`, sends them through Photon, and records the result; inbound texts and tapbacks go to
`agent_handle_inbound`. Photon notes and the build plan: `docs/PLAN.md`.

**Brushing reminders.** People set a morning and a night brush time on Profile (`user_settings.morning_reminder` /
`night_reminder`, in their `timezone`). Every 5 s, `run_due_jobs` calls `enqueue_brush_reminders()`, which queues a
`reminder` 5 minutes before each time (once per slot per local day, logged in `brush_reminders`) to the person's
verified iMessage number, ignoring quiet hours. It skips people who are brushing or brushed in the last 30 minutes.
The agent adds `Start brushing → <SITE_URL>/start`. `claim_outbound` drops reminders still unsent after 10 minutes.

```sh
cd backend && npm install
# fill in backend/.env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY),
# and for real iMessages AGENT_MODE=photon, PHOTON_PROJECT_ID, PHOTON_PROJECT_SECRET
npm run dev
```

`AGENT_MODE` defaults to **terminal**: messages are printed instead of sent. Terminal mode only drains the
outbox of a local database, so it never swallows real messages queued on the hosted project. In photon mode
the agent also adds every phone in `channel_identities` to Photon's project Users, and every number waiting to
be verified (`phone_verifications`), recording the Photon line assigned to it.
`npx tsx --env-file=.env src/agent/dev.ts [welcome] +1…` sends one sample message without the database.

### Connecting friends and phones

- **Friends:** Circle → *Share your invite link*. The link survives Google sign-in and connects you as soon
  as the friend has set up. Adding someone by the email they signed in with also works.
- **Phones:** Google accounts have no phone number, so nobody gets iMessages until they add one, by texting
  in (migrations 0006 and 0015). Profile, Circle or Settings → enter the number (`start_phone_verification`).
  Within a few seconds the agent adds it to Photon's Users and records the user's Photon line; the website
  then shows *Text to verify*, which opens Messages addressed to that line with "Verify 123456" filled in.
  When the text arrives, `agent_handle_inbound` links the number and the agent answers with a welcome.
  Texting in is required: Photon's shared lines give every user their own number, and only message numbers
  that texted it first ("Target not allowed for this project"). If friends had invited that number earlier,
  the placeholder profile merges into the account (friendships and received updates carry over).
- Migrations 0007-0011 were retired and their numbers are not reused, because some databases already
  applied them. `0006_phone_verification` stays because the hosted project has it applied.

Tests: `npm test` (agent) and the SQL suites in `backend/supabase/tests/` (see *Local stack* above).
