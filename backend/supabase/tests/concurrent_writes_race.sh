#!/usr/bin/env bash
# Two-session races behind migration 0009 (one transaction can't race itself). Run with:
#   bash supabase/tests/concurrent_writes_race.sh [postgresql://postgres:postgres@127.0.0.1:54322/postgres]
#
# Each case opens session A, a psql fed through a FIFO so its transaction stays open between steps, and
# session B, a second psql in the background. A writes and keeps its transaction open; B starts a
# competing write; the script waits until B is blocked on a lock (or has finished) and only then commits
# A. That makes the interleaving deterministic instead of timing-dependent.
#
# This commits real rows to the local database: phones +155502xxxxx, emails and names starting with
# race-c-. It deletes everything it made at the end, and at the start in case a run was interrupted.
set -u
DB="${1:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
case "$DB" in
  *@127.0.0.1:*|*@localhost:*) ;;
  *) echo "refusing to run against a non-local database: $DB" >&2; exit 2 ;;
esac

WORK=$(mktemp -d "${TMPDIR:-/tmp}/race-c.XXXXXX")
APP="race-c-$$"
FAILS=0
q() { psql "$DB" -X -q -At -v ON_ERROR_STOP=1 "$@"; }

# ── Fixtures ──────────────────────────────────────────────────────────────────────────────────

cleanup() {
  local extra; extra=$(cat "$WORK"/*.out "$WORK"/*.res 2>/dev/null | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | sort -u | paste -sd, -)
  q -v extra="{${extra}}" <<'SQL'
-- Profiles made here: race-c- names and emails, anyone holding a test number, and ids the cases printed
-- (e.g. a guest left without a number). Cascades take settings, numbers, friendships, texts, codes.
delete from public.profiles p where p.id in (
  select user_id from public.channel_identities where address ~ '^\+155502[0-9]{5}$'
  union select id from public.profiles where display_name like 'race-c-%'
  union select p2.id from public.profiles p2 join auth.users u on u.id = p2.auth_user_id where u.email like 'race-c-%@example.com'
  union select x.id from public.profiles x where x.id = any (:'extra'::uuid[]) and x.auth_user_id is null
);
delete from public.phone_verifications where phone ~ '^\+155502[0-9]{5}$';
delete from auth.users where email like 'race-c-%@example.com';
SQL
}

setup() {
  q <<'SQL'
-- Google-style accounts (email, no phone). The sign-up trigger makes their profiles.
insert into auth.users (id, email, raw_user_meta_data, aud, role)
select gen_random_uuid(), 'race-c-' || n || '@example.com', jsonb_build_object('full_name', 'race-c-' || n),
       'authenticated', 'authenticated'
from unnest(array['a1','b1','c1','e1','v1','w1','w2','w3','w4','y1','l1','x1']) n;

create temp table acct as
  select n, p.id from unnest(array['a1','b1','c1','e1','v1','w1','w2','w3','w4','y1','l1','x1']) n
  join auth.users u on u.email = 'race-c-' || n || '@example.com' join public.profiles p on p.auth_user_id = u.id;

-- Quiet hours around now for everyone here, so no test invite is due to send while it exists.
update public.user_settings set timezone = 'UTC',
  quiet_start = (now() at time zone 'UTC' - interval '1 hour')::time,
  quiet_end   = (now() at time zone 'UTC' + interval '6 hours')::time
where user_id in (select id from acct);

-- Guests that friends invited by text earlier: g3 (for 3a), g6..g9 (merges).
create temp table guest as select * from (values
  ('g3', '+15550200003', null), ('g6', '+15550200006', 'y1'), ('g7', '+15550200007', 'y1'),
  ('g8', '+15550200008', 'y1'), ('g9', '+15550200009', 'y1')) v(n, phone, inviter);
insert into public.profiles (display_name) select 'race-c-' || n from guest;
insert into public.user_settings (user_id, timezone, quiet_start, quiet_end)
select p.id, 'UTC', (now() at time zone 'UTC' - interval '1 hour')::time, (now() at time zone 'UTC' + interval '6 hours')::time
from guest g join public.profiles p on p.display_name = 'race-c-' || g.n;
insert into public.channel_identities (user_id, channel, address)
select p.id, 'imessage', g.phone from guest g join public.profiles p on p.display_name = 'race-c-' || g.n;
-- y1 asked g6..g9 earlier; each is still pending.
insert into public.friendships (user_a, user_b, status, requested_by)
select least(p.id, y.id), greatest(p.id, y.id), 'pending', y.id
from guest g join public.profiles p on p.display_name = 'race-c-' || g.n join acct y on y.n = g.inviter;

-- e1 is a signed-in friend whose number is already verified (for 3b).
insert into public.channel_identities (user_id, channel, address, verified_at)
select id, 'imessage', '+15550200004', now() from acct where n = 'e1';

-- Invite links for c1 (4a) and y1 (9).
insert into public.invites (inviter_id) select id from acct where n in ('c1', 'y1');

-- Open verifications (typed on the website, not yet texted). With the demo trigger (0007) on, an open row
-- only survives if completing it fails, so x1 briefly holds each number (phone_taken) and then lets go.
insert into public.channel_identities (user_id, channel, address, verified_at)
select (select id from acct where n = 'x1'), 'sms', phone, now()
from unnest(array['+15550200005','+15550200006','+15550200007','+15550200008','+15550200009','+15550200010']) phone;
do $$
declare
  r record;
  v_code text;
begin
  for r in select * from (values ('v1', '+15550200005'), ('w1', '+15550200006'), ('w2', '+15550200007'),
                                 ('w3', '+15550200008'), ('w4', '+15550200009'), ('l1', '+15550200010')) v(n, phone) loop
    loop
      v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
      exit when not exists (select 1 from public.phone_verifications where code = v_code and verified_at is null);
    end loop;
    insert into public.phone_verifications (user_id, phone, code)
    values ((select id from acct where n = r.n), r.phone, v_code);
  end loop;
end $$;
delete from public.channel_identities where user_id = (select id from acct where n = 'x1');
SQL
}

auth_of() { q -c "select id from auth.users where email = 'race-c-$1@example.com'"; }
code_of() { q -c "select code from public.phone_verifications v join public.profiles p on p.id = v.user_id
                  where p.auth_user_id = '$(auth_of "$1")'"; }
token_of() { q -c "select token from public.invites i join public.profiles p on p.id = i.inviter_id
                   where p.auth_user_id = '$(auth_of "$1")'"; }
# SQL that makes the rest of a transaction run as a signed-in user, or as the agent (service role).
as_user() { echo "set local role authenticated; set local request.jwt.claims = '{\"sub\":\"$(auth_of "$1")\",\"role\":\"authenticated\"}';"; }
AS_AGENT="set local role service_role;"

# ── Sessions ──────────────────────────────────────────────────────────────────────────────────

a_open() {
  rm -f "$WORK/a.fifo"; mkfifo "$WORK/a.fifo"
  PGAPPNAME="$APP-A" psql "$DB" -X -q -At -v ON_ERROR_STOP=0 -f "$WORK/a.fifo" >"$WORK/a.log" 2>&1 &
  A_PID=$!
  exec 3>"$WORK/a.fifo"
  A_STEP=0
}
# a SQL [name]: run SQL in session A and wait until it's done. With a name, the result of the last
# query (which must not end in ';') is saved to $WORK/<name>.res.
a() {
  A_STEP=$((A_STEP + 1))
  if [ $# -ge 2 ]; then
    printf '%s \\g %s\n' "$1" "$WORK/$2.res" >&3
  else
    printf '%s\n' "$1" >&3
  fi
  printf '\\! touch %s\n' "$WORK/a.$A_STEP" >&3
  local i=0
  while [ ! -e "$WORK/a.$A_STEP" ]; do
    i=$((i + 1)); [ $i -gt 600 ] && { echo "session A is stuck" >&2; return 1; }
    sleep 0.05
  done
}
a_close() { printf '\\q\n' >&3; exec 3>&-; wait "$A_PID" 2>/dev/null; }

# b_start SQL: run SQL in session B in the background; its output goes to $WORK/b.out and b.err.
b_start() {
  printf '%s\n' "$1" >"$WORK/b.sql"
  PGAPPNAME="$APP-B" psql "$DB" -X -q -At -v ON_ERROR_STOP=1 -f "$WORK/b.sql" >"$WORK/b.out" 2>"$WORK/b.err" &
  B_PID=$!
}
# Wait until B is waiting on a lock or has finished; prints which.
b_settle() {
  local i w
  for i in $(seq 1 200); do
    if ! kill -0 "$B_PID" 2>/dev/null; then echo "finished without waiting"; return; fi
    w=$(q -c "select wait_event_type || ':' || wait_event from pg_stat_activity where application_name = '$APP-B' and state = 'active'")
    case "$w" in Lock:*) echo "blocked on $w"; return ;; esac
    sleep 0.05
  done
  echo "still running after 10 s"
}
b_finish() { wait "$B_PID"; B_RC=$?; }

# race ID TITLE "A's SQL (last query's result saved)" "B's SQL": A runs and holds, B starts, A commits
# once B settles.
race() {
  local name=$1
  echo
  echo "── $1 $2"
  a_open
  a "begin;"
  a "$3" "$name-a"
  b_start "$4"
  B_STATE=$(b_settle)
  a "commit;"
  a_close
  b_finish
  A_RES=$(cat "$WORK/$name-a.res" 2>/dev/null)
  B_RES=$(cat "$WORK/b.out")
  cp "$WORK/b.out" "$WORK/$name-b.res"
  echo "   A: ${A_RES:-<no result>} $(grep -h ERROR "$WORK/a.log" | tail -1)"
  echo "   B: $B_STATE, then ${B_RES:-<no result>} $(grep -h ERROR "$WORK/b.err" | head -1)"
}

# verdict "SQL returning one row: ok boolean, detail text"
verdict() {
  local out
  out=$(q -F '|' -v a="$A_RES" -v b="$B_RES" -f - <<SQL
$1
SQL
)
  case "$out" in
    t\|*) echo "   PASS ${out#t|}" ;;
    *) echo "   FAIL ${out#f|}"; FAILS=$((FAILS + 1)) ;;
  esac
}
J="nullif(:'a', '')::jsonb"   # A's result
K="nullif(:'b', '')::jsonb"   # B's result (null if B failed)

A_PID=; B_PID=
trap 'kill $A_PID $B_PID 2>/dev/null; cleanup; rm -rf "$WORK"' EXIT
cleanup
setup || { echo "setup failed" >&2; exit 1; }
DEMO=$(q -c "select exists (select 1 from pg_trigger where tgname = 'demo_auto_verify_phone' and tgenabled <> 'D')")

# ── 1. Two first texts from a new number ──────────────────────────────────────────────────────
# Without a lock, B doesn't see A's uncommitted guest, makes a second one, and its identity insert
# waits on A's and then does nothing: B's STOP lands on a profile with no number.
race 1 "two first texts from a new number" \
  "$AS_AGENT select public.agent_handle_inbound('imessage', '+15550200001', 'hi')" \
  "begin; $AS_AGENT select public.agent_handle_inbound('imessage', '+15550200001', 'STOP'); commit;"
verdict "select (select count(*) = 1 from public.channel_identities where address = '+15550200001' and opted_out_at is not null)
           and $K->>'user_id' = $J->>'user_id',
         format('B stopped %s, A is %s; number opted out: %s', $K->>'user_id', $J->>'user_id',
                (select opted_out_at is not null from public.channel_identities where address = '+15550200001'))"

# ── 2. Two people invite the same new number ──────────────────────────────────────────────────
race 2 "two people invite the same new number" \
  "$(as_user a1) select public.invite_friend('+1 555 020 0002', 'race-c-g2')" \
  "begin; $(as_user b1) select public.invite_friend('(555) 020-0002', 'race-c-g2'); commit;"
verdict "select $K->>'friend_id' = $J->>'friend_id' and $K->>'status' = 'pending'
           and (select count(distinct user_id) = 1 from public.channel_identities where address = '+15550200002'),
         format('B: %s', coalesce($K::text, 'error'))"

# ── 3. The 30-day invite text goes out once ───────────────────────────────────────────────────
race 3a "two people invite the same guest by phone" \
  "$(as_user a1) select public.invite_friend('+15550200003')" \
  "begin; $(as_user b1) select public.invite_friend('+15550200003'); commit;"
verdict "select count(*) = 1, format('%s invite texts to the guest', count(*))
         from public.outbound_messages o join public.channel_identities ci on ci.user_id = o.user_id
         where ci.address = '+15550200003' and o.kind = 'invite'"

race 3b "one invites by email, one by phone, same friend" \
  "$(as_user a1) select public.invite_friend('race-c-e1@example.com')" \
  "begin; $(as_user b1) select public.invite_friend('+15550200004'); commit;"
verdict "select count(*) = 1, format('%s invite texts to e1', count(*))
         from public.outbound_messages o join public.profiles p on p.id = o.user_id
         where p.display_name = 'race-c-e1' and o.kind = 'invite'"

# ── 4. First link between the same pair ───────────────────────────────────────────────────────
race 4a "c1 invites a1 while a1 accepts c1's link" \
  "$(as_user c1) select public.invite_friend('race-c-a1@example.com')" \
  "begin; $(as_user a1) select public.accept_invite('$(token_of c1)'); commit;"
verdict "select coalesce(:'b', '') = 'accepted'
           and (select f.status from public.friendships f join public.profiles x on x.id in (f.user_a, f.user_b)
                join public.profiles y on y.id in (f.user_a, f.user_b)
                where x.display_name = 'race-c-a1' and y.display_name = 'race-c-c1') = 'accepted',
         format('B: %s', coalesce(nullif(:'b', ''), 'error'))"

race 4b "double-click: b1 invites c1 twice" \
  "$(as_user b1) select public.invite_friend('race-c-c1@example.com')" \
  "begin; $(as_user b1) select public.invite_friend('race-c-c1@example.com'); commit;"
verdict "select $K->>'status' = 'pending', format('B: %s', coalesce($K::text, 'error'))"

# ── 5. The same "Verify 123456" twice ─────────────────────────────────────────────────────────
V_CODE=$(code_of v1)
race 5 "the same Verify text twice" \
  "$AS_AGENT select public.agent_handle_inbound('imessage', '+15550200005', 'Verify $V_CODE')" \
  "begin; $AS_AGENT select public.agent_handle_inbound('imessage', '+15550200005', 'Verify $V_CODE'); commit;"
verdict "select $J->>'action' = 'verified' and $K->>'action' = 'ignored' and $K->>'user_id' = $J->>'user_id',
         format('A: %s, B: %s', $J->>'action', coalesce($K->>'action', 'error'))"

# ── 6. Merging a guest while someone links to it ──────────────────────────────────────────────
W1_CODE=$(code_of w1); W2_CODE=$(code_of w2); W3_CODE=$(code_of w3)
race 6a "a1 invites a guest's number while its owner verifies it" \
  "$(as_user a1) select public.invite_friend('+15550200006')" \
  "begin; $AS_AGENT select public.agent_handle_inbound('imessage', '+15550200006', 'Verify $W1_CODE'); commit;"
verdict "select $K->>'action' = 'verified' and exists (
           select 1 from public.friendships f join public.profiles x on x.id in (f.user_a, f.user_b)
           join public.profiles y on y.id in (f.user_a, f.user_b)
           where x.display_name = 'race-c-a1' and y.display_name = 'race-c-w1' and f.status = 'pending')
           and exists (select 1 from public.outbound_messages o join public.profiles p on p.id = o.user_id
                       where p.display_name = 'race-c-w1' and o.kind = 'invite'),
         format('a1 -> w1 request after the merge: %s, invite text kept: %s',
           exists (select 1 from public.friendships f join public.profiles x on x.id in (f.user_a, f.user_b)
                   join public.profiles y on y.id in (f.user_a, f.user_b)
                   where x.display_name = 'race-c-a1' and y.display_name = 'race-c-w1'),
           exists (select 1 from public.outbound_messages o join public.profiles p on p.id = o.user_id
                   where p.display_name = 'race-c-w1' and o.kind = 'invite'))"

race 6b "the owner verifies a guest's number while a1 invites it" \
  "$AS_AGENT select public.agent_handle_inbound('imessage', '+15550200007', 'Verify $W2_CODE')" \
  "begin; $(as_user a1) select public.invite_friend('+15550200007'); commit;"
verdict "select $K->>'status' = 'pending'
           and $K->>'friend_id' = (select id::text from public.profiles where display_name = 'race-c-w2'),
         format('B: %s', coalesce($K::text, 'error'))"

race 6c "the owner verifies a guest's number while it texts STOP" \
  "$AS_AGENT select public.agent_handle_inbound('imessage', '+15550200008', 'Verify $W3_CODE')" \
  "begin; $AS_AGENT select public.agent_handle_inbound('imessage', '+15550200008', 'STOP'); commit;"
verdict "select $K->>'action' = 'stopped'
           and (select opted_out_at is not null from public.channel_identities where address = '+15550200008'),
         format('B: %s; number opted out: %s', coalesce($K->>'action', 'error'),
                (select opted_out_at is not null from public.channel_identities where address = '+15550200008'))"

# ── X. (found while fixing 4) merge re-points a friendship that link_friends is creating ─────
W4_CODE=$(code_of w4)
race X "w4 accepts y1's link while verifying the number y1 invited" \
  "$(as_user w4) select public.accept_invite('$(token_of y1)')" \
  "begin; $AS_AGENT select public.agent_handle_inbound('imessage', '+15550200009', 'Verify $W4_CODE'); commit;"
verdict "select $K->>'action' = 'verified'
           and (select f.status from public.friendships f join public.profiles x on x.id in (f.user_a, f.user_b)
                join public.profiles y on y.id in (f.user_a, f.user_b)
                where x.display_name = 'race-c-w4' and y.display_name = 'race-c-y1') = 'accepted',
         format('B: %s', coalesce($K->>'action', 'error'))"

# ── L. Lock order: website start_phone_verification (demo trigger) vs. the agent verifying ────
# A holds the number's lock (as agent_handle_inbound does), then, still in the same transaction,
# verifies the old code, which needs the verification row. B is the website re-entering the number,
# which writes that row and (demo mode) completes it, needing the number's lock. Both must take the
# number first, the row second, or this deadlocks.
if [ "$DEMO" = "t" ]; then
  L_CODE=$(code_of l1)
  echo
  echo "── L start_phone_verification vs. a Verify text for the same number (lock order)"
  a_open
  a "begin;"
  a "$AS_AGENT select public.agent_handle_inbound('imessage', '+15550200010', 'hello')" "L-a1"
  b_start "begin; $(as_user l1) select public.start_phone_verification('+15550200010'); commit;"
  B_STATE=$(b_settle)
  a "select public.agent_handle_inbound('imessage', '+15550200010', 'Verify $L_CODE')" "L-a2"
  a "commit;"
  a_close
  b_finish
  A_RES=$(cat "$WORK/L-a2.res" 2>/dev/null); B_RES=$(cat "$WORK/b.out"); cp "$WORK/b.out" "$WORK/L-b.res"
  echo "   A: ${A_RES:-<no result>} $(grep -h ERROR "$WORK/a.log" | tail -1)"
  echo "   B: $B_STATE, then ${B_RES:-<no result>} $(grep -h ERROR "$WORK/b.err" | head -1)"
  verdict "select $J->>'action' = 'verified' and $K->>'phone' = '+15550200010'
             and not exists (select 1 from public.phone_verifications v join public.profiles p on p.id = v.user_id
                             where p.display_name = 'race-c-l1' and v.verified_at is null),
           format('A: %s, B: %s', coalesce($J->>'action', 'error'), coalesce($K::text, 'error'))"
else
  echo; echo "── L skipped: the demo auto-verify trigger is off"
fi

echo
if [ "$FAILS" -eq 0 ]; then echo "all race cases passed"; else echo "$FAILS race case(s) failed"; fi
exit $(( FAILS > 0 ))
