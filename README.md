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

The database queues every outgoing message (check-in deliveries, invites, brushing-now, reactions) in
`outbound_messages`. The agent in `backend/src/agent/` claims them with the `claim_outbound` RPC, sends them
through Photon, and reports back with `complete_outbound`; inbound texts go to `agent_handle_inbound`.
See `docs/PLAN.md` for the Photon setup (`PHOTON_PROJECT_ID` / `PHOTON_PROJECT_SECRET` in `backend/.env`)
and the build phases.

```sh
cd backend && npm install && npm run build && npm test
```
