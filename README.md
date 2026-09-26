# Toothbrush Connect

A website that turns the two minutes you spend brushing your teeth into a check-in with hometown friends. You post an update on the site; after the 30 s delivery hold, the backend's messaging agent sends it to each friend over iMessage via Photon Spectrum (WhatsApp / SMS as fallback).

```
website (post update) → Supabase RPC post_check_in → 30 s hold (pg_cron) → fan-out → outbox → agent-dispatch → Photon → iMessage
                                                     Photon webhook → photon-webhook function (STOP, YES, tapbacks, replies)
```

## Layout

```
frontend/   React + TypeScript + Vite website (installable PWA), talks to Supabase via supabase-js
  src/pages/        Landing, Login (phone code), Onboarding, Invite, Brush, Circle, Timeline, Lists, Settings
  src/components/   timer, check-in (mood chips, audience sheet, hold banner), feed, presence, layout
  src/hooks/        countdown, session, presence (Supabase Realtime), wake lock, haptics
  src/api/client.ts Typed wrappers around the Supabase RPCs

supabase/   Backend, hosted on Supabase (project: driftwatch, ref iltbflwrlybklasqpudg)
  migrations/       Schema, RLS policies and RPCs (check-ins, 30 s hold, fan-out, invites, lists)
  functions/        Edge functions: agent-dispatch (sends the outbox via Photon), photon-webhook (inbound)
  tests/            SQL smoke test for the core loop and audience enforcement
  config.toml       Auth: phone sign-in, test numbers

docs/       PRD
```

## Setup

The website needs `frontend/.env.local` with the project URL and publishable key (see `frontend/.env.example`).

```sh
cd frontend && npm install && npm run dev        # http://localhost:5173
```

Sign-in is **Google** (Supabase Auth OAuth; the client ID and secret are set in the Supabase dashboard under
Authentication → Providers → Google). Google accounts start without a phone number; phone numbers, which
iMessage delivery needs, come later.

Phone sign-in is built but off. Turn it on with `VITE_ENABLE_PHONE_AUTH=true` once an SMS sender exists
(plan: Photon through Supabase's Send SMS hook). Test numbers `+1 555 000 0001` … `0004` use code `123456`.

**Backend changes** go in a new file under `supabase/migrations/`, then:

```sh
supabase db push            # apply migrations to the hosted project
supabase config push        # apply auth settings from config.toml; review the diff first. Fill in the
                            # SUPABASE_AUTH_EXTERNAL_GOOGLE_* values in supabase/.env, or it will blank
                            # out the Google credentials set in the dashboard.
```

**Local stack** (optional, needs Docker): `supabase start`, then point `frontend/.env.local` at
`http://127.0.0.1:54321` with the key from `supabase status`. Run the SQL smoke test with
`psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/tests/core_flow.sql`.

**Agent messages** are queued in `outbound_messages` and sent by the `agent-dispatch` function. Without
`PHOTON_PROJECT_ID` / `PHOTON_PROJECT_SECRET` it runs in dry-run mode and only logs. To let pg_cron trigger
it on the hosted project, add two Vault secrets: `project_url` and `service_role_key`.
