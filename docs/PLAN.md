# Messaging Agent — Implementation Plan

## Context

Toothbrush Connect posts updates **only on the website**. When the 30 s delivery hold ends, the
**messaging agent** (`backend/src/agent/`, called "messaging service" in the PRD) delivers each
update to recipients through **Photon Spectrum** → iMessage (WhatsApp / SMS fallback). It also
handles inbound traffic (STOP, auto-reply pointing to the website, tapbacks), but inbound text
never creates a check-in (PRD FR-C7).

```
website → POST /v1/check-ins → 30 s hold job → services/fanout → agent/send-update
        → routing (channel-router, batcher) → templates → provider → Photon → iMessage/WhatsApp/SMS
Photon stream (app.messages) → agent/inbound/handler → commands | relay | auto-reply
```

### Current state (as of 2026-09-26)
- Every file in `backend/src/agent/` is a one-line comment stub. `backend/package.json` has **no
  dependencies**; `src/index.ts`, `config.ts`, `db/client.ts` are stubs too.
- Reusable today: `domain/moods.ts` (`MOODS` emoji + label), `domain/audience.ts`,
  `domain/analytics.ts`, migration `0001_init.sql` (`channel_identities` with `opted_out_at`,
  `check_in_recipients` with `photon_message_id`).
- **Drift to fix along the way:**
  - Stub comments cite PRD v2 IDs (FR-M2, FR-M7, FR-M8, FR-R8, "STOP = FR-A5"). v3 equivalents:
    labels FR-D3, fallback FR-D2, relay FR-D7, authorization FR-R7, STOP FR-D6.
  - `inbound/commands.ts` mentions `YES` to accept invites — v3 accepts via invite link; drop it.
  - Schema lacks PRD tables `message_deliveries` and `magic_links`, and `reactions.source`.
    `users.preferred_channel` uses `'web'` where the PRD says `receive_channel = 'none'`.
  - README says the PRD is iMessage-first; that is no longer true (v3).

### Photon Spectrum facts (Phase 0 spike, 2026-09-26, `spectrum-ts` 12.10.1)
Tested against the project's **shared** iMessage line +1 (415) 579-6445 with test phone +1 (763) 406-0903.

- **Setup:** `import { Spectrum } from "spectrum-ts"`, `import { imessage } from "@spectrum-ts/imessage"`;
  `await Spectrum({ projectId, projectSecret, providers: [imessage.config()] })`. Env names in the
  starter are `PROJECT_ID` / `PROJECT_SECRET`; we use `PHOTON_PROJECT_ID` / `PHOTON_PROJECT_SECRET`.
  Other installed providers: `@spectrum-ts/whatsapp-business`, `telegram`, `slack`, `terminal`.
- **Inbound needs no webhook.** `for await (const [space, message] of app.messages)` streams events
  over the SDK's own connection — no public URL, tunnel or webhook secret. (`app.webhook()` exists
  for serverless hosts; not needed while the agent runs as a long-lived process.)
- **Outbound send:** `const space = await imessage(app).space.create("+1…")` then
  `await space.send(text)` → returns a `Message` with `id` `spc-msg-<uuid>`. Space ids look like
  `any;-;+17634060903`; `space.phone` is `"shared"` on a shared line.
- **⚠️ Outbound-first is blocked until the recipient texts the line.** Before the test phone had
  texted, `send` failed with `AuthenticationError: [spectrum-imessage] Target not allowed for this
  project` (`retryable: false`). After one inbound "Hello", the same agent-initiated send succeeded.
  Photon's dashboard also says the shared line only talks to phones added under **Users**.
- **Inbound text:** `message.content = { type: "text", text }`, `message.sender.id` = E.164 phone,
  `sender.service` = `"iMessage" | "SMS" | "RCS" | "unknown"`, `direction: "inbound"`.
- **Tapbacks arrive on the same stream:** `content = { type: "reaction", emoji: "❤️", target }`, where
  `target.id` is **our original outbound message id** → look up `check_in_recipients.photon_message_id`
  to relay the reaction (FR-D7). Reaction ids look like `<targetId>:reaction:<n>:0`.
- **Delivery state** is on the message (`isDelivered`, `dateDelivered`, `sendErrorCode`); no separate
  delivery-receipt event was observed.
- **Tapping a link** in a message produces no event — link opens must be tracked by our own link service.
- **SMS:** no SMS *sending* provider in the SDK; `sender.service` can report SMS but we cannot choose it.

## Design principles
1. **Agent owns messaging only.** Fan-out, audience resolution and authorization stay in
   `services/`. The agent receives already-authorized `(recipientId, checkInIds[])` jobs.
2. **Provider interface isolates Photon** (`providers/types.ts`) so providers are swappable
   (PRD risk mitigation) and tests use a fake.
3. **Templates are pure functions**, so the FR-D3 lint (label first, magic link last) is a unit test.
4. **Idempotent sends**: one `message_deliveries` row per outbound message, unique idempotency
   key per batch → zero duplicates on retries.
5. **Website never depends on Photon**: failures queue and retry; feed delivery is unaffected.

## Module design

| File | Responsibility | Exports (sketch) |
| --- | --- | --- |
| `providers/types.ts` | `MessagingProvider` interface: `send(address, text, opts) → { providerMessageId }`, `channel` | `MessagingProvider`, `OutboundMessage`, `InboundEvent` |
| `providers/imessage.ts` | Wrap Spectrum `imessage` provider | `createIMessageProvider(app)` |
| `providers/whatsapp.ts` | Wrap Spectrum WhatsApp Business (template-message rules) | `createWhatsAppProvider(app)` |
| `providers/sms.ts` | SMS fallback — separate vendor (e.g. Twilio) unless Photon confirms support | `createSmsProvider(cfg)` |
| `index.ts` | Build the Spectrum app from `config.ts`, register providers, expose `send()` and run the inbound `app.messages` loop; `terminal` provider when `AGENT_MODE=terminal` | `createAgent(config)` |
| `templates/labels.ts` | Label catalog from PRD (mood, CLOSE CIRCLE, JUST FOR YOU, 3 UPDATES, BRUSHING NOW, EDITED, REACTION, REPLY, CODE, INVITE, DIGEST, POST ON THE WEB) built from `domain/moods.ts` | `label(kind, params)` |
| `templates/messages.ts` | Render full messages: `[label] body\n<cta> → <magic link>`; never includes other recipients' names | `renderUpdate`, `renderBatch`, `renderInvite`, `renderCode`, … |
| `routing/channel-router.ts` | Pick channel from `users.preferred_channel` + `channel_identities`; skip opted-out / `web`-only | `resolveChannel(userId)` |
| `routing/batcher.ts` | Per-recipient 60 s window (BullMQ delayed job keyed by recipient), ≤ 3 updates per message, ≤ 6 update messages/day, quiet hours → hold until `quiet_end` | `enqueueUpdate(recipientId, checkInId)` |
| `send-update.ts` | Batch job worker: load check-ins, re-check status (skip undone/deleted), render, send, record | `sendUpdateBatch(job)` |
| `send-invite.ts` | One `[👋 INVITE]` per invitee per 30 days (FR-S1) | `sendInvite(inviterId, phone)` |
| `send-*` (new, small) | `sendCode` (OTP, FR-A1), `sendBrushingNow` (1/day, quiet hours, FR-P3), `sendEdited` (FR-C5), `sendReactionNotice` / `sendReplyNotice` (FR-S5) | — |
| `inbound/handler.ts` | Map sender address → user via `channel_identities`; dispatch | `handleInbound(event)` |
| `inbound/commands.ts` | `STOP` / `UNSUBSCRIBE` → set `opted_out_at` (FR-D6); `START` → clear; `HELP` → info | `handleCommand` |
| `inbound/relay.ts` | Tapback on a delivered update → `reactions` row (source `tapback`) + notify author (FR-D7, P1); any other text → one `[ℹ️ POST ON THE WEB]` per 12 h (FR-D5) | `relayTapback`, `autoReply` |

Supporting changes outside `agent/`:
- `db/migrations/0002_messaging.sql`: `message_deliveries` (id, recipient_id, channel, check_in_ids uuid[], kind, idempotency_key UNIQUE, provider_message_id, status, error, sent_at), `magic_links` (token_hash, user_id, target_path, expires_at, used_at, revoked_at), `reactions.source`.
- `services/links.ts` (new): mint signed, 24 h, single-user magic links (FR-W7); `GET /v1/l/:token` redeem route.
- `routes/webhooks.ts`: not needed while inbound uses `app.messages`; keep the stub for a possible serverless deploy.
- `services/fanout.ts`: after writing `check_in_recipients`, call `batcher.enqueueUpdate` per recipient.
- `config.ts`: validate `PHOTON_PROJECT_ID`, `PHOTON_PROJECT_SECRET` (rename from `PHOTON_API_KEY` to match SDK), `PUBLIC_LINK_BASE_URL`, `AGENT_MODE`.
- `domain/analytics.ts`: add `message_sent`, `message_failed`, `message_link_opened`, `stop_received`, `channel_disabled`.

## Phases

| # | Phase | Deliverables | Done when |
| --- | --- | --- | --- |
| 0 | **Spike + tooling** ✅ | Spike done (see Photon facts). Installed `spectrum-ts`, `@spectrum-ts/imessage`, `pg`, `bullmq`, `ioredis`, `zod` 4; dev: `typescript`, `tsx`, `vitest` 5, `@types/node`, `@types/pg`. `package-lock.json` committed. Backend CI moved to Node 22 (vitest 5 needs ≥ 22.12). `.env.example` uses `PHOTON_PROJECT_ID` / `PHOTON_PROJECT_SECRET`. | ✅ `npm ci && npm run build && npm test` pass in `backend/` |
| 1 | **Templates + labels** | `labels.ts`, `messages.ts`, `test/templates.test.ts` (every template starts with a catalog label and ends with a link; no recipient names leak) | Tests green in CI |
| 2 | **Providers + agent core** | `types.ts`, `imessage.ts`, `whatsapp.ts`, fake provider for tests, `index.ts` with terminal mode | `AGENT_MODE=terminal` prints a rendered update |
| 3 | **Data + links** | Migration `0002`, `services/links.ts`, redeem route | Link opens the target screen signed in; expired/revoked link rejected |
| 4 | **Outbound update path** | `channel-router.ts`, `batcher.ts`, `send-update.ts`, fan-out wiring | Post on website → labelled iMessage within 5 s p95 after hold; 3 posts within 60 s → one `[📦 3 UPDATES]`; retries produce no duplicate |
| 5 | **Other outbound** | invite, code, brushing-now, edited, reaction/reply notices; caps + quiet hours | Caps and quiet hours covered by tests |
| 6 | **Inbound** | `app.messages` loop, `handler.ts`, `commands.ts`, `relay.ts` (auto-reply now; tapbacks behind a P1 flag) | STOP stops all channel delivery immediately while web feed still works; replies get ≤ 1 auto-response per 12 h; inbound text never creates a check-in |
| 7 | **Fallbacks + hardening** | WhatsApp path, SMS provider, Photon-outage retry (BullMQ backoff), analytics events, stub-comment and README cleanup | Photon down → website unaffected, messages send on recovery |

## Testing and verification
- **Unit (vitest)**: templates, labels, channel router, batcher window/caps/quiet hours, command parsing — all with the fake provider; no network.
- **Integration**: `docker compose up -d` (Postgres + Redis); run fan-out → batcher → `send-update` against the fake provider; assert `message_deliveries` rows and idempotency under a forced retry.
- **Local manual**: `AGENT_MODE=terminal npm run dev`, post a check-in from the frontend, watch the rendered message in the terminal.
- **Staging**: real Photon test line + 2 test phones; verify iMessage delivery, magic link, reply auto-response, STOP/START, and WhatsApp for a non-iMessage number.

## Open questions
- **Blocker for invites and sign-in codes — ask Photon:** a recipient must text the line before the
  agent can message them ("Target not allowed for this project"). Does a dedicated line allow
  agent-initiated first messages to new numbers? If not, `[👋 INVITE]` and `[🔑 CODE]` need another
  path (e.g. the invite link is shared by the inviter; the code goes by SMS vendor), and sign-up must
  ask users to text the line once to turn on iMessage delivery.
- Does Photon provide SMS, or do we add a separate SMS vendor? (No SMS sending provider in the SDK.)
- Dedicated Photon line per user or a shared pool? (PRD open question; affects `index.ts` routing.)
- Skip the iMessage copy if the recipient already saw the update on the web? (PRD open question; affects `send-update.ts` — default: always send.)
- HTTP framework for `src/index.ts` (Hono recommended — first-party Spectrum adapter, Web `Request` API).
