-- MVP schema: updates are posted on the website and delivered over iMessage (Photon).
-- Live presence and delivery-hold timers live in Redis, not here.

CREATE TABLE users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone            text NOT NULL UNIQUE,  -- E.164; the identity (FR-A1)
  display_name     text NOT NULL,
  status           text NOT NULL DEFAULT 'guest' CHECK (status IN ('guest', 'active')),  -- guest = receives by iMessage, no web account yet
  preferred_channel text NOT NULL DEFAULT 'imessage' CHECK (preferred_channel IN ('imessage', 'whatsapp', 'sms', 'web')),
  timezone         text NOT NULL DEFAULT 'UTC',
  quiet_start      time NOT NULL DEFAULT '23:00',
  quiet_end        time NOT NULL DEFAULT '07:00',
  invisible        boolean NOT NULL DEFAULT false,
  dominant_hand    text NOT NULL DEFAULT 'right' CHECK (dominant_hand IN ('left', 'right')),
  default_list_id  uuid,                  -- null = Everyone
  presence_list_id uuid,                  -- null = follows default audience
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Messaging addresses used by the Photon agent; opted_out_at is set on STOP (FR-A5).
CREATE TABLE channel_identities (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel      text NOT NULL CHECK (channel IN ('imessage', 'whatsapp', 'sms')),
  address      text NOT NULL,           -- E.164 phone or iMessage email
  verified_at  timestamptz,
  opted_out_at timestamptz,
  UNIQUE (channel, address)
);

CREATE TABLE push_subscriptions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   text NOT NULL UNIQUE,
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invites (
  token       text PRIMARY KEY,
  inviter_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  accepted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE friendships (
  user_a     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     text NOT NULL CHECK (status IN ('pending', 'accepted', 'blocked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_a, user_b),
  CHECK (user_a < user_b)
);

CREATE TABLE friend_lists (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE users
  ADD FOREIGN KEY (default_list_id)  REFERENCES friend_lists(id) ON DELETE SET NULL,
  ADD FOREIGN KEY (presence_list_id) REFERENCES friend_lists(id) ON DELETE SET NULL;

CREATE TABLE friend_list_members (
  list_id   uuid NOT NULL REFERENCES friend_lists(id) ON DELETE CASCADE,
  friend_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (list_id, friend_id)
);

CREATE TABLE brush_sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at   timestamptz,
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned'))
);
CREATE UNIQUE INDEX one_active_session_per_user ON brush_sessions (user_id) WHERE status = 'active';

CREATE TABLE check_ins (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id    uuid REFERENCES brush_sessions(id) ON DELETE SET NULL,
  mood          text NOT NULL CHECK (mood IN ('fun', 'stressful', 'boring', 'just_okay')),
  scope         text NOT NULL DEFAULT 'today' CHECK (scope IN ('today', 'this_week')),
  text          text CHECK (char_length(text) <= 140),
  audience_type text NOT NULL CHECK (audience_type IN ('everyone', 'list', 'custom')),
  list_id       uuid REFERENCES friend_lists(id) ON DELETE SET NULL,
  status        text NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'delivered', 'undone', 'deleted')),
  deliver_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  edited_at     timestamptz
);

-- Authorization source of truth (FR-R8); PK makes fan-out idempotent.
CREATE TABLE check_in_recipients (
  check_in_id       uuid NOT NULL REFERENCES check_ins(id) ON DELETE CASCADE,
  recipient_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel           text NOT NULL,        -- channel the agent delivered on
  delivery_status   text NOT NULL DEFAULT 'pending' CHECK (delivery_status IN ('pending', 'sent', 'delivered', 'failed')),
  photon_message_id text,                 -- lets inbound tapbacks / replies map back to this check-in
  delivered_at      timestamptz,
  seen_at           timestamptz,
  PRIMARY KEY (check_in_id, recipient_id)
);

CREATE TABLE reactions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  check_in_id uuid REFERENCES check_ins(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('wave', 'heart', 'laugh', 'reply')),
  text        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
