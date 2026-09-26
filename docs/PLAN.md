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

### Scope: `backend/src/agent/` only
Other people own the rest of the backend. This plan **only creates or edits files under
`backend/src/agent/`**. Everything the agent needs from outside (database access, magic links,
job scheduling, analytics, the call from fan-out) is expressed as a **port**: a TypeScript
interface defined in `agent/ports.ts` and passed into `createAgent()`. The agent ships with
in-memory fakes for tests; the backend owners supply the real implementations (see
[Handoffs](#handoffs-to-the-backend-owners)).

- May **import** (read-only) from `src/domain/` (e.g. `MOODS`); never edit it.
- Tests live next to the code as `agent/**/*.test.ts` (vitest's default glob finds them), not in `backend/test/`.
- Agent config (`PHOTON_PROJECT_ID`, `PHOTON_PROJECT_SECRET`, `AGENT_MODE`) is read by `agent/config.ts`, not `src/config.ts`.
- Phase 0 changed four shared files before this scope was set, trimmed to what the agent needs:
  `backend/package.json` / `package-lock.json` (agent dependencies only), `.env.example` (Photon
  variables) and `.github/workflows/ci.yml` (backend job on Node 22). Let the backend owners know.

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
1. **Agent owns messaging only.** Fan-out, audience resolution and authorization stay outside
   `agent/`. The agent receives already-authorized `(recipientId, checkInId)` calls.
2. **Ports, not imports.** The agent never imports `db/`, `services/`, `jobs/` or `routes/`; it talks
   to them through the interfaces in `agent/ports.ts`, so it builds and tests on its own.
3. **Provider interface isolates Photon** (`providers/types.ts`) so providers are swappable
   (PRD risk mitigation) and tests use a fake.
4. **Templates are pure functions**, so the FR-D3 lint (label first, magic link last) is a unit test.
5. **Idempotent sends**: every outbound message has an idempotency key per batch; the delivery store
   refuses a second send with the same key → zero duplicates on retries.
6. **Website never depends on Photon**: failures are retried; feed delivery is unaffected.

## Module design (all under `backend/src/agent/`)

| File | Responsibility | Exports (sketch) |
| --- | --- | --- |
| `ports.ts` (new) | Interfaces the backend implements: `RecipientDirectory`, `DeliveryStore`, `LinkMinter`, `Scheduler`, `ReactionSink`, `Analytics`, `Clock` (see Handoffs) | types only |
| `fakes.ts` (new) | In-memory implementations of every port + a fake provider, for tests and terminal mode | `createFakes()` |
| `config.ts` (new) | Read and validate `PHOTON_PROJECT_ID`, `PHOTON_PROJECT_SECRET`, `AGENT_MODE` (`photon` / `terminal`) with zod | `loadAgentConfig(env)` |
| `providers/types.ts` | `MessagingProvider`: `send(address, text) → { providerMessageId }`, `channel`; `InboundEvent` (text / reaction) | `MessagingProvider`, `InboundEvent` |
| `providers/imessage.ts` | Wrap Spectrum `imessage`: `space.create(phone)` + `space.send`; map `app.messages` to `InboundEvent`; map "Target not allowed" to a typed `RecipientNotReachable` error | `createIMessageProvider(app)` |
| `providers/whatsapp.ts` | Wrap Spectrum WhatsApp Business (template-message rules) | `createWhatsAppProvider(app)` |
| `providers/sms.ts` | SMS fallback: separate vendor unless Photon confirms support | `createSmsProvider(cfg)` |
| `index.ts` | `createAgent({ config, ports })`: build the Spectrum app, register providers, run the inbound loop; `terminal` provider when `AGENT_MODE=terminal`. **Public API:** `deliverCheckIn`, `notifyEdited`, `sendInvite`, `sendCode`, `sendBrushingNow`, `sendReactionNotice`, `sendReplyNotice`, `start`, `stop` | `createAgent` |
| `templates/labels.ts` | Label catalog from the PRD (mood, CLOSE CIRCLE, JUST FOR YOU, 3 UPDATES, BRUSHING NOW, EDITED, REACTION, REPLY, CODE, INVITE, DIGEST, POST ON THE WEB), built from `domain/moods.ts` | `label(kind, params)` |
| `templates/messages.ts` | Render full messages: `[label] body\n<cta> → <link>`; never includes other recipients' names | `renderUpdate`, `renderBatch`, `renderInvite`, `renderCode`, … |
| `routing/channel-router.ts` | Pick a channel from the recipient's preferred channel and identities (via `RecipientDirectory`); skip opted-out / web-only | `resolveChannel(recipient)` |
| `routing/batcher.ts` | Per-recipient 60 s window (via `Scheduler`), ≤ 3 updates per message, ≤ 6 update messages/day, quiet hours → hold until quiet end | `enqueueUpdate`, `flushBatch` |
| `send-update.ts` | Batch flush: load check-ins, skip undone/deleted, render, send, record | `sendUpdateBatch` |
| `send-invite.ts` | One `[👋 INVITE]` per invitee per 30 days (FR-S1) | `sendInvite` |
| `send-*` (new, small) | `sendCode` (FR-A1), `sendBrushingNow` (1/day, quiet hours, FR-P3), `sendEdited` (FR-C5), `sendReactionNotice` / `sendReplyNotice` (FR-S5) | — |
| `inbound/handler.ts` | Map sender address → user (via `RecipientDirectory`); dispatch | `handleInbound(event)` |
| `inbound/commands.ts` | `STOP` / `UNSUBSCRIBE` → opt out (FR-D6); `START` → opt back in; `HELP` → info | `handleCommand` |
| `inbound/relay.ts` | Tapback → look up the delivery by `target.id` → `ReactionSink` + notify author (FR-D7, P1); any other text → one `[ℹ️ POST ON THE WEB]` per 12 h (FR-D5) | `relayTapback`, `autoReply` |

## Handoffs to the backend owners
The agent defines these; someone outside `agent/` implements and wires them.

| Port / hook | What the agent needs | Likely owner file |
| --- | --- | --- |
| `RecipientDirectory` | `getRecipient(userId)` (display name, timezone, quiet hours, preferred channel, identities + opt-out state), `findByAddress(channel, address)`, `setOptOut(channel, address, at \| null)` | `db/`, `users` + `channel_identities` |
| `DeliveryStore` | `claim(idempotencyKey, row)` (fails on duplicate), `markSent(id, providerMessageId)`, `markFailed(id, error)`, `findByProviderMessageId(id)`, `countToday(recipientId, kind)`, `lastSentAt(recipientId, kind)` | migration `0002`: `message_deliveries` table |
| `CheckInReader` | `getCheckIns(ids)` → author name, mood, scope, text, audience type, status | `services/check-ins.ts` |
| `LinkMinter` | `mint(userId, targetPath)` → short signed URL (24 h, single user, FR-W7) | `services/links.ts` + `magic_links` table + redeem route |
| `Scheduler` | `schedule(key, runAt, payload)` / `cancel(key)`; calls back `agent.flushBatch(key)` | `jobs/queues.ts` (BullMQ) |
| `ReactionSink` | `recordReaction({ fromUserId, checkInId, kind, source: "tapback" })` | `routes/reactions.ts` / `reactions.source` column |
| `Analytics` | `track(event, props)` for `message_sent`, `message_failed`, `message_link_opened`, `stop_received`, `channel_disabled` | `domain/analytics.ts` |
| **Call-in** | `services/fanout.ts` calls `agent.deliverCheckIn(checkInId, recipientIds)` after writing `check_in_recipients`; auth, invites, reactions, presence call the other `send*` methods | `services/`, `routes/`, `realtime/` |
| **Startup** | `src/index.ts` calls `createAgent({ config, ports })` and `agent.start()` | `src/index.ts` |

## Phases (all work inside `agent/`)

| # | Phase | Deliverables | Done when |
| --- | --- | --- | --- |
| 0 | **Spike + tooling** ✅ | Spike done (see Photon facts). Installed only what the agent uses: `spectrum-ts`, `@spectrum-ts/imessage`, `zod` 4; dev: `typescript`, `tsx`, `vitest` 5, `@types/node`. (`pg`, `bullmq`, `ioredis` are left to the backend owners.) `package-lock.json` committed. Backend CI moved to Node 22 (vitest 5 needs ≥ 22.12). `.env.example` uses `PHOTON_PROJECT_ID` / `PHOTON_PROJECT_SECRET`. | ✅ `npm ci && npm run build && npm test` pass in `backend/` |
| 1 | **Templates + labels** ✅ | `templates/labels.ts`, `templates/messages.ts`, `templates/messages.test.ts` (every template starts with a catalog label and ends with a link; no recipient names leak) | ✅ Tests green |
| 2 | **Core send path** ✅ | `config.ts`, `providers/types.ts`, `providers/imessage.ts`, `providers/terminal.ts`, `ports.ts` (`DeliveryLog`, `LinkBuilder`), `fakes.ts`, `index.ts` (`createAgent().deliverCheckIn(checkIn, recipients)`), `dev.ts` | ✅ `AGENT_MODE=terminal` prints a rendered update (Node and Deno); retries never double-send; live send to the test phone delivered (spc-msg-d7c41e97…) |
| 3 | **Website hookup** (backend owners) | Edge function calls `deliverCheckIn` when `deliver_check_in` runs; `DeliveryLog` on `outbound_messages`; SQL stops rendering message text | Post on the website → iMessage arrives after the 30 s hold |
| 4 | **STOP** | Photon webhook → `STOP` / `START` sets opt-out; `[ℹ️ POST ON THE WEB]` auto-reply to other texts | STOP ends iMessages immediately; website unaffected |

**Scope trimmed (2026-09-26).** The agent is only: post on the website → Photon → iMessage to each recipient,
sent when the 30 s hold ends. No AI. Cut for now: batching and daily caps, quiet hours, WhatsApp/SMS,
invites/codes/brushing-now by text, tapback relay. The templates for those stay; the sections above that
describe them are kept for later.

**Deno note:** edge functions run on Deno, and our imports use Node-style `.js` suffixes. Verified with
Deno 2.9: works with `--unstable-sloppy-imports` (or `"unstable": ["sloppy-imports"]` in the function's
`deno.json`).

Integration with the real database, queue and fan-out happens when the backend owners implement
the ports; the agent's fakes define the expected behavior.

## Testing and verification
- **Unit (vitest, `agent/**/*.test.ts`)**: templates, labels, channel router, batcher window/caps/quiet hours, command parsing, relay: all with `fakes.ts`; no network, no database.
- **Local manual**: a small script in `agent/` (e.g. `agent/dev.ts`) that creates the agent with fakes and `AGENT_MODE=terminal`, then calls `deliverCheckIn` and prints the message.
- **Live Photon**: the same script with `AGENT_MODE=photon` against the shared line and the test phone (+1 763-406-0903): delivery, tapback relay, reply auto-response, STOP/START.
- **Integration** (backend owners, after ports are real): `docker compose up -d`, post on the website, see the iMessage within 5 s p95 after the hold.

## Open questions
- **Blocker for invites and sign-in codes, ask Photon:** a recipient must text the line before the
  agent can message them ("Target not allowed for this project"). Does a dedicated line allow
  agent-initiated first messages to new numbers? If not, `[👋 INVITE]` and `[🔑 CODE]` need another
  path (e.g. the inviter shares the invite link; the code goes by an SMS vendor), and sign-up must
  ask users to text the line once to turn on iMessage delivery.
- Does Photon provide SMS, or do we add a separate SMS vendor? (No SMS sending provider in the SDK.)
- Dedicated Photon line per user or a shared pool? (PRD open question; affects `index.ts` routing.)
- Skip the iMessage copy if the recipient already saw the update on the web? (PRD open question; affects `send-update.ts`; default: always send.)
- Port shapes need a quick review with the backend owners before Phase 3, so the real implementations match.
