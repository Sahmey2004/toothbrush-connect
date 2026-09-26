-- Toothbrush Connect schema (PRD "Data model and API").
-- Updates are posted on the website and delivered to friends over iMessage / WhatsApp / SMS by the
-- Photon agent (edge functions), or read on the website. All reads go through RLS; all state
-- transitions go through the security-definer RPCs in 20260926000002_functions.sql.

create extension if not exists pgcrypto with schema extensions;

-- ── People ────────────────────────────────────────────────────────────────────────────────────

-- One row per person, including guest friends who were invited by text and never signed in.
-- auth_user_id is set once the person signs in on the website with their phone (FR-A1).
create table public.profiles (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid unique references auth.users(id) on delete set null,
  display_name  text not null default '' check (char_length(display_name) <= 40),
  status        text not null default 'guest' check (status in ('guest', 'active')),
  created_at    timestamptz not null default now()
);

create table public.friend_lists (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 30),
  letter     char(1) not null,
  created_at timestamptz not null default now(),
  unique (owner_id, letter)
);
create unique index friend_lists_owner_name on public.friend_lists (owner_id, lower(name));

-- Private per-user settings; only the owner can read them.
create table public.user_settings (
  user_id           uuid primary key references public.profiles(id) on delete cascade,
  timezone          text not null default 'UTC',
  brush_times       text[] not null default '{morning,night}',
  quiet_start       time not null default '23:00',
  quiet_end         time not null default '07:00',
  invisible         boolean not null default false,
  dominant_hand     text not null default 'right' check (dominant_hand in ('left', 'right')),
  preferred_channel text not null default 'imessage' check (preferred_channel in ('imessage', 'whatsapp', 'sms', 'web')),
  default_list_id   uuid references public.friend_lists(id) on delete set null,  -- null = Everyone
  presence_list_id  uuid references public.friend_lists(id) on delete set null,  -- null = follows default audience
  onboarded_at      timestamptz
);

-- Messaging addresses used by the agent; opted_out_at is set on STOP (FR-A5).
create table public.channel_identities (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  channel      text not null check (channel in ('imessage', 'whatsapp', 'sms')),
  address      text not null,  -- E.164
  verified_at  timestamptz,
  opted_out_at timestamptz,
  unique (channel, address)
);
create index channel_identities_user on public.channel_identities (user_id);

-- ── Circle ────────────────────────────────────────────────────────────────────────────────────

create table public.friendships (
  user_a       uuid not null references public.profiles(id) on delete cascade,
  user_b       uuid not null references public.profiles(id) on delete cascade,
  status       text not null check (status in ('pending', 'accepted', 'blocked')),
  requested_by uuid not null references public.profiles(id) on delete cascade,
  blocked_by   uuid references public.profiles(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b)
);
create index friendships_user_b on public.friendships (user_b);

-- Shareable invite links (/invite/:token). Text invites are tracked in outbound_messages.
create table public.invites (
  token       text primary key default encode(extensions.gen_random_bytes(12), 'hex'),
  inviter_id  uuid not null references public.profiles(id) on delete cascade,
  expires_at  timestamptz not null default now() + interval '30 days',
  created_at  timestamptz not null default now()
);

create table public.friend_list_members (
  list_id   uuid not null references public.friend_lists(id) on delete cascade,
  friend_id uuid not null references public.profiles(id) on delete cascade,
  primary key (list_id, friend_id)
);

-- ── Sessions and check-ins ────────────────────────────────────────────────────────────────────

create table public.brush_sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  channel    text not null default 'web' check (channel in ('web', 'imessage', 'whatsapp', 'sms')),
  started_at timestamptz not null default now(),
  ends_at    timestamptz not null default now() + interval '2 minutes',
  ended_at   timestamptz,
  status     text not null default 'active' check (status in ('active', 'completed', 'abandoned'))
);
create unique index one_active_session_per_user on public.brush_sessions (user_id) where status = 'active';
create index brush_sessions_recent on public.brush_sessions (started_at desc);

create table public.check_ins (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  session_id    uuid references public.brush_sessions(id) on delete set null,
  mood          text not null check (mood in ('fun', 'stressful', 'boring', 'just_okay')),
  scope         text not null default 'today' check (scope in ('today', 'this_week')),
  text          text check (char_length(text) <= 140),
  audience_type text not null check (audience_type in ('everyone', 'list', 'custom')),
  list_id       uuid references public.friend_lists(id) on delete set null,
  friend_ids    uuid[] not null default '{}',  -- custom audience, resolved into recipients at delivery
  status        text not null default 'held' check (status in ('held', 'delivered', 'undone', 'deleted')),
  deliver_at    timestamptz not null default now() + interval '30 seconds',
  delivered_at  timestamptz,
  created_at    timestamptz not null default now(),
  edited_at     timestamptz
);
create index check_ins_due on public.check_ins (deliver_at) where status = 'held';
create index check_ins_user on public.check_ins (user_id, created_at desc);

-- Authorization source of truth (FR-R8); the primary key makes fan-out idempotent.
create table public.check_in_recipients (
  check_in_id       uuid not null references public.check_ins(id) on delete cascade,
  recipient_id      uuid not null references public.profiles(id) on delete cascade,
  audience_label    text not null check (audience_label in ('everyone', 'close_circle', 'just_for_you')),
  channel           text not null,
  delivered_at      timestamptz not null default now(),
  seen_at           timestamptz,
  primary key (check_in_id, recipient_id)
);
create index check_in_recipients_recipient on public.check_in_recipients (recipient_id, delivered_at desc);

create table public.reactions (
  id          uuid primary key default gen_random_uuid(),
  from_user   uuid not null references public.profiles(id) on delete cascade,
  to_user     uuid not null references public.profiles(id) on delete cascade,
  check_in_id uuid references public.check_ins(id) on delete cascade,
  kind        text not null check (kind in ('wave', 'heart', 'laugh', 'reply')),
  text        text check (char_length(text) <= 280),
  created_at  timestamptz not null default now()
);
create index reactions_to_user on public.reactions (to_user, created_at desc);

-- ── Agent outbox ──────────────────────────────────────────────────────────────────────────────

-- Every agent message is written here first and sent by the agent-dispatch edge function.
-- One check_in row per (check-in, recipient) keeps retries from double-sending (PRD "Zero duplicate deliveries").
create table public.outbound_messages (
  id                  bigint generated always as identity primary key,
  user_id             uuid not null references public.profiles(id) on delete cascade,
  channel             text not null check (channel in ('imessage', 'whatsapp', 'sms')),
  address             text not null,
  kind                text not null,  -- started, done, check_in, edited, invite, presence, presence_proactive, reaction, reply, system
  body                text not null,
  effect              text,           -- iMessage effect, e.g. 'confetti' on DONE
  check_in_id         uuid references public.check_ins(id) on delete cascade,
  status              text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts            int not null default 0,
  error               text,
  provider_message_id text,
  send_after          timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  sent_at             timestamptz
);
create unique index outbound_one_per_check_in on public.outbound_messages (check_in_id, user_id) where kind = 'check_in';
create index outbound_pending on public.outbound_messages (send_after) where status = 'pending';
create index outbound_provider_id on public.outbound_messages (provider_message_id) where provider_message_id is not null;

-- ── Row level security ────────────────────────────────────────────────────────────────────────

alter table public.profiles            enable row level security;
alter table public.user_settings       enable row level security;
alter table public.channel_identities  enable row level security;
alter table public.friendships         enable row level security;
alter table public.invites             enable row level security;
alter table public.friend_lists        enable row level security;
alter table public.friend_list_members enable row level security;
alter table public.brush_sessions      enable row level security;
alter table public.check_ins           enable row level security;
alter table public.check_in_recipients enable row level security;
alter table public.reactions           enable row level security;
alter table public.outbound_messages   enable row level security;  -- no policies: service role only

-- Realtime: friends' presence, deliveries and reactions (RLS is applied per subscriber).
alter publication supabase_realtime add table public.brush_sessions, public.check_in_recipients, public.reactions, public.friendships;
