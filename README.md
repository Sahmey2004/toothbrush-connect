# Toothbrush Connect

A website that turns the two minutes you spend brushing your teeth into a check-in with hometown friends. You post an update on the site; after the 30 s delivery hold, the backend's messaging agent sends it to each friend over iMessage via Photon Spectrum (WhatsApp / SMS as fallback).

```
frontend (post update) → backend /v1/check-ins → 30 s hold job → fan-out → agent → Photon → iMessage
                                                                  Photon webhook → agent/inbound (STOP, YES, tapbacks, replies)
```

> `docs/PRD.md` describes the original iMessage-first design, where check-ins were also *posted* by text. Posting now happens on the website; delivery still goes over iMessage.

## Layout

```
frontend/   React + TypeScript + Vite web app (installable PWA)
  src/pages/        Landing, Login, Onboarding, Invite, Brush, Circle, Timeline, Lists, Settings
  src/components/   timer, check-in (mood chips, audience picker, hold banner), feed, presence, layout
  src/hooks/        countdown, session, presence, wake lock, haptics, push subscription
  src/api/, src/realtime/, src/types/
  public/sw.js      Service worker for Web Push

backend/    Node + TypeScript API, WebSocket server and messaging agent
  src/agent/        Photon Spectrum agent: providers (iMessage, WhatsApp, SMS), labelled templates,
                    send-update / send-invite, channel routing + batching, inbound webhook handling
  src/routes/       REST endpoints under /v1, plus /webhooks/photon
  src/services/     sessions, check-ins, audience resolution, authorization, fan-out
  src/realtime/     WebSocket server, Redis presence, overlap detection, rate limits
  src/jobs/         30 s delivery hold, session done/abandon, weekly digest
  src/notifications/ Web Push
  src/db/           Postgres client + SQL migrations
  src/domain/       Moods, audiences, events, analytics types

docs/       PRD
```

## Local development

```sh
docker compose up -d                                   # Postgres + Redis
cd backend  && cp .env.example .env && npm install && npm run dev   # :3000
cd frontend && cp .env.example .env && npm install && npm run dev   # :5173, proxies /v1 and /ws
```
