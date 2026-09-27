#!/usr/bin/env bash
# Two-session races in brushing sessions and check-ins (migration 0011). Run with:
#   bash supabase/tests/session_races.sh [postgresql://postgres:postgres@127.0.0.1:54322/postgres]
#
# Same harness as concurrent_writes_race.sh: each psql session is fed through a FIFO so its transaction
# stays open between steps, and the script waits until a session is blocked on a lock (or has finished)
# before moving the other one on. That makes each interleaving deterministic.
#
# pg_cron runs public.run_due_jobs() every 5 s on this database, so it sees everything committed here.
# Fixture check-ins and sessions are due 10 minutes out, so it leaves them alone. A case that needs a
# committed row to be due first waits until the next cron run is a few seconds away (cron_gap), then makes
# the row due and locks it in the same breath, so only the case's own sessions ever see it due.
#
# This commits real rows to the local database: phones +155504xxxxx, emails and names starting with
# race-e-. It deletes everything it made at the end, and at the start in case a run was interrupted.
# Texts that would be due right away (presence, DONE) are marked skipped before their transaction
# commits; everyone else is in quiet hours, so nothing here is sent.
set -u
DB="${1:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
case "$DB" in
  *@127.0.0.1:*|*@localhost:*) ;;
  *) echo "refusing to run against a non-local database: $DB" >&2; exit 2 ;;
esac

WORK=$(mktemp -d "${TMPDIR:-/tmp}/race-e.XXXXXX")
APP="race-e-$$"
FAILS=0
q() { psql "$DB" -X -q -At -v ON_ERROR_STOP=1 "$@"; }

# ── Fixtures ──────────────────────────────────────────────────────────────────────────────────

MINE="(select id from public.profiles where display_name like 'race-e-%')"

cleanup() {
  q <<'SQL'
-- Held ones first, so a cron run doesn't start delivering them while their author is deleted.
update public.check_ins set status = 'undone'
where status = 'held' and user_id in (select id from public.profiles where display_name like 'race-e-%');
-- Cascades take settings, numbers, friendships, lists, sessions, check-ins, recipients, texts.
delete from public.profiles p where p.id in (
  select user_id from public.channel_identities where address ~ '^\+155504[0-9]{5}$'
  union select id from public.profiles where display_name like 'race-e-%'
  union select p2.id from public.profiles p2 join auth.users u on u.id = p2.auth_user_id where u.email like 'race-e-%@example.com'
);
delete from auth.users where email like 'race-e-%@example.com';
SQL
}

setup() {
  q <<'SQL'
-- Google-style accounts (email, no phone). The sign-up trigger makes their profiles and settings.
create temp table acct (n text primary key);
insert into acct select unnest(array[
  'r1', 'r2', 'r3',                    -- friends who receive updates
  's1', 'f1',                          -- 1: s1 starts twice; f1 is brushing
  'p1',                                -- 2: two first posts
  'u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'w0', 'u8', 'u9', 'u10', 'u11',  -- 3: check-in writes vs. delivery
  'j1',                                -- 4: run_due_jobs twice
  'k1', 'k2', 'k3', 'k4',              -- 5: sessions vs. run_due_jobs
  'x1', 'y1', 'fp',                    -- 6: x1 and y1 start at once; fp is their friend
  'v1', 'u12']);                       -- 7, 8: lock order
insert into auth.users (id, email, raw_user_meta_data, aud, role)
select gen_random_uuid(), 'race-e-' || n || '@example.com', jsonb_build_object('full_name', 'race-e-' || n),
       'authenticated', 'authenticated'
from acct;
create temp table ids as select a.n, p.id from acct a join public.profiles p on p.display_name = 'race-e-' || a.n;

-- Quiet hours around now for everyone except fp, so updates and edits queued here aren't due for hours.
update public.user_settings set timezone = 'UTC',
  quiet_start = (now() at time zone 'UTC' - interval '1 hour')::time,
  quiet_end   = (now() at time zone 'UTC' + interval '6 hours')::time
where user_id in (select id from ids);
update public.user_settings set quiet_start = '00:00', quiet_end = '00:00' where user_id = (select id from ids where n = 'fp');

-- Messaging numbers for everyone who is texted here.
insert into public.channel_identities (user_id, channel, address, verified_at)
select i.id, 'imessage', v.phone, now()
from (values ('r1', '+15550400001'), ('r2', '+15550400002'), ('r3', '+15550400003'), ('f1', '+15550400004'),
             ('j1', '+15550400010'), ('k1', '+15550400011'), ('k2', '+15550400012'), ('k3', '+15550400013'),
             ('k4', '+15550400014'), ('fp', '+15550400020')) v(n, phone)
join ids i on i.n = v.n;

insert into public.friendships (user_a, user_b, status, requested_by)
select least(a.id, b.id), greatest(a.id, b.id), 'accepted', a.id
from (values ('s1', 'f1'), ('p1', 'r1'), ('u1', 'r1'), ('u2', 'r1'), ('u3', 'r1'), ('u3', 'r2'), ('u4', 'r1'),
             ('u4', 'r2'), ('u5', 'r1'), ('u6', 'r1'), ('u7', 'r1'), ('w0', 'r3'), ('u8', 'r1'), ('u9', 'r1'),
             ('u10', 'r1'), ('u11', 'r1'), ('j1', 'r1'), ('x1', 'fp'), ('y1', 'fp'), ('v1', 'r1'), ('u12', 'r3')) v(x, y)
join ids a on a.n = v.x join ids b on b.n = v.y;

-- u3 and u4 each have a list with only r2 in it.
insert into public.friend_lists (owner_id, name) select id, 'race-e close' from ids where n in ('u3', 'u4');
insert into public.friend_list_members (list_id, friend_id)
select l.id, (select id from ids where n = 'r2') from public.friend_lists l where l.owner_id in (select id from ids where n in ('u3', 'u4'));

-- Active sessions, ending 10 minutes out (j1 and k1..k4 brush by text, so they get a DONE).
insert into public.brush_sessions (user_id, channel, ends_at)
select i.id, case when i.n ~ '^[jk]' then 'imessage' else 'web' end, now() + interval '10 minutes'
from ids i
where i.n in ('f1', 'p1', 'u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8', 'u9', 'u10', 'u11', 'j1', 'k1', 'k2', 'k3', 'k4', 'v1', 'u12');

-- A held check-in (audience: everyone) in each of these sessions; w0's has no session.
insert into public.check_ins (user_id, session_id, mood, text, audience_type, deliver_at)
select i.id, s.id, 'fun', 'race-e original', 'everyone', now() + interval '10 minutes'
from ids i left join public.brush_sessions s on s.user_id = i.id and s.status = 'active'
where i.n in ('u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'w0', 'u8', 'u9', 'u10', 'u11', 'j1', 'v1', 'u12');
SQL
}

prof() { q -c "select id from public.profiles where display_name = 'race-e-$1'"; }
auth_of() { q -c "select id from auth.users where email = 'race-e-$1@example.com'"; }
ci_of() { q -c "select c.id from public.check_ins c join public.profiles p on p.id = c.user_id where p.display_name = 'race-e-$1'"; }
sess_of() { q -c "select s.id from public.brush_sessions s join public.profiles p on p.id = s.user_id
                  where p.display_name = 'race-e-$1' and s.status = 'active'"; }
list_of() { q -c "select l.id from public.friend_lists l join public.profiles p on p.id = l.owner_id where p.display_name = 'race-e-$1'"; }
# SQL that makes the rest of a transaction run as a signed-in user (the website).
as_user() { echo "set local role authenticated; set local request.jwt.claims = '{\"sub\":\"$(auth_of "$1")\",\"role\":\"authenticated\"}';"; }
# Texts due right away (presence, DONE) never reach the agent: mark them before the transaction commits.
SKIP_DUE="reset role; update public.outbound_messages set status = 'skipped', error = 'race-e test'
          where status = 'pending' and kind in ('done', 'presence', 'presence_proactive') and user_id in $MINE;"

# ── Sessions ──────────────────────────────────────────────────────────────────────────────────

# Up to three psql sessions per case, A, B and L, each fed through a FIFO on its own file descriptor.
fd_of() { case $1 in A) echo 3 ;; B) echo 4 ;; L) echo 5 ;; esac; }
open() {
  local n=$1 fd; fd=$(fd_of "$n")
  rm -f "$WORK/$n.fifo" "$WORK/$n".*.done; mkfifo "$WORK/$n.fifo"
  PGAPPNAME="$APP-$n" psql "$DB" -X -q -At -v ON_ERROR_STOP=0 -f "$WORK/$n.fifo" >"$WORK/$n.log" 2>&1 &
  eval "PID_$n=\$!; STEP_$n=0"
  eval "exec $fd>\"\$WORK/\$n.fifo\""
}
# send N SQL [RES]: queue SQL in session N and return at once. With RES, the result of the last query
# (which must not end in ';') is saved to $WORK/RES.res.
send() {
  local n=$1 fd k; fd=$(fd_of "$n")
  eval "k=\$((STEP_$n + 1)); STEP_$n=\$k"
  {
    if [ $# -ge 3 ]; then printf '%s \\g %s\n' "$2" "$WORK/$3.res"; else printf '%s\n' "$2"; fi
    printf '\\! touch %s\n' "$WORK/$n.$k.done"
  } >&"$fd"
}
# await N: wait until everything queued in session N has run.
await() {
  local n=$1 k i=0; eval "k=\$STEP_$n"
  while [ ! -e "$WORK/$n.$k.done" ]; do
    i=$((i + 1)); [ $i -gt 600 ] && { echo "session $n is stuck" >&2; return 1; }
    sleep 0.05
  done
}
run() { send "$@"; await "$1"; }
# settle N: wait until session N's last step is waiting on a lock or has finished; prints which.
settle() {
  local n=$1 k i w; eval "k=\$STEP_$n"
  for i in $(seq 1 200); do
    if [ -e "$WORK/$n.$k.done" ]; then echo "finished without waiting"; return; fi
    w=$(q -c "select wait_event_type || ':' || wait_event from pg_stat_activity where application_name = '$APP-$n' and state = 'active'")
    case "$w" in Lock:*) echo "blocked on $w"; return ;; esac
    sleep 0.05
  done
  echo "still running after 10 s"
}
close() {
  local n=$1 fd; fd=$(fd_of "$n")
  printf '\\q\n' >&"$fd"; eval "exec $fd>&-"
  eval "wait \$PID_$n" 2>/dev/null
}
res() { cat "$WORK/$1.res" 2>/dev/null; }
err() { grep -h -m1 'ERROR:' "$WORK/$1.log" 2>/dev/null | sed 's/^.*ERROR: *//'; }

# cron_gap SECONDS: return once pg_cron's next run_due_jobs is at least SECONDS away. pg_cron starts the
# job every 5 s and a run takes a few ms, so rows a case makes due are seen by its own sessions only.
CRON_JOB=$(q -c "select jobid from cron.job where command like '%run_due_jobs%' limit 1" 2>/dev/null)
cron_gap() {
  [ -z "$CRON_JOB" ] && return 0
  local need=$1 i left
  for i in $(seq 1 200); do
    left=$(q -c "select coalesce(extract(epoch from start_time + interval '5 seconds' - clock_timestamp()), -1)
                 from cron.job_run_details where jobid = $CRON_JOB and status in ('succeeded', 'failed')
                 order by runid desc limit 1")
    awk "BEGIN { exit !(${left:--1} >= $need) }" && return 0
    sleep 0.05
  done
  echo "   (couldn't find a gap between pg_cron runs; carrying on)"
}

title() { echo; echo "── $1"; rm -f "$WORK"/*.res; }
show() {
  echo "   A: ${A_RES:-ok}${A_ERR:+ ERROR: $A_ERR}"
  echo "   B: ${B_STATE:-}${B_STATE:+, then }${B_RES:-ok}${B_ERR:+ ERROR: $B_ERR}"
}
# collect: read A's and B's saved results and first errors (A_KEY/B_KEY name the saved results).
collect() { A_RES=$(res "$1"); B_RES=$(res "$2"); A_ERR=$(err A); B_ERR=$(err B); }

# verdict "SQL returning one row: ok boolean, detail text". :'a' / :'b' are A's and B's results,
# :'aerr' / :'berr' their first errors ('' if none).
verdict() {
  local out
  out=$(q -F '|' -v a="$A_RES" -v b="$B_RES" -v aerr="$A_ERR" -v berr="$B_ERR" -f - <<SQL
$1
SQL
)
  case "$out" in
    t\|*) echo "   PASS ${out#t|}" ;;
    *) echo "   FAIL ${out#f|}"; FAILS=$((FAILS + 1)) ;;
  esac
}

# Two-session race. A runs A_SQL inside a transaction and holds it; B runs B_SQL in its own transaction;
# once B is blocked (or done), A commits and B finishes. A_PRE runs in A before its transaction (used to
# make a committed row due right before A locks it). Results: A's last query -> A_RES, B's -> B_RES.
race() {  # race TITLE A_PRE A_SQL B_SQL [A_BEFORE_COMMIT] [B_BEFORE_COMMIT]
  title "$1"
  open A; open B
  run A "$2 begin; $3" a
  send B "begin;"; send B "$4" b; [ -n "${6:-}" ] && send B "$6"; send B "commit;"
  # settle on B's main step: that's the one that waits.
  local k; eval "k=\$STEP_B"
  if [ -n "${6:-}" ]; then STEP_B=$((k - 2)); else STEP_B=$((k - 1)); fi
  B_STATE=$(settle B)
  STEP_B=$k
  [ -n "${5:-}" ] && run A "$5"
  run A "commit;"
  await B
  close A; close B
  collect a b
  show
}

PID_A=; PID_B=; PID_L=
trap 'kill $PID_A $PID_B $PID_L 2>/dev/null; cleanup; rm -rf "$WORK"' EXIT
cleanup
setup || { echo "setup failed" >&2; exit 1; }

R1=$(prof r1); R2=$(prof r2); R3=$(prof r3); F1=$(prof f1); FP=$(prof fp)
for n in u1 u2 u3 u4 u5 u6 u7 w0 u8 u9 u10 u11 j1 v1 u12; do eval "C_$n=\$(ci_of $n)"; done
for n in p1 u7 j1 k1 k2 k3 k4 v1; do eval "S_$n=\$(sess_of $n)"; done
L_u3=$(list_of u3); L_u4=$(list_of u4)
DUE="update public.check_ins set deliver_at = now() - interval '1 second' where id ="
RDJ="select public.run_due_jobs()"

# ── 1. start_session: a double-click ──────────────────────────────────────────────────────────
# Both found no active session; the second insert waited for the first and then failed on
# one_active_session_per_user, so the website showed an error.
race "1 start_session twice at once (double-click, two tabs)" "" \
  "$(as_user s1) select (public.start_session()).id" \
  "$(as_user s1) select (public.start_session()).id" "$SKIP_DUE" "$SKIP_DUE"
verdict "select :'berr' = '' and :'b' = :'a'
           and (select count(*) = 1 from public.brush_sessions where user_id = '$(prof s1)' and status = 'active')
           and (select count(*) = 1 from public.outbound_messages where user_id = '$F1' and kind = 'presence' and body like '%race-e-s1%'),
         format('B got %s; active sessions: %s; brushing-now texts to f1: %s', coalesce(nullif(:'berr', ''), :'b'),
           (select count(*) from public.brush_sessions where user_id = '$(prof s1)' and status = 'active'),
           (select count(*) from public.outbound_messages where user_id = '$F1' and kind = 'presence' and body like '%race-e-s1%'))"

# ── 2. post_check_in: the first two posts of a session ────────────────────────────────────────
# Neither found a check-in to replace (the other's was uncommitted), so both inserted one and friends
# would get two updates from one session.
race "2 post_check_in twice at once, first posts in a session" "" \
  "$(as_user p1) select (public.post_check_in('fun', 'today', 'race-e first')).id" \
  "$(as_user p1) select (public.post_check_in('boring', 'today', 'race-e second')).id"
verdict "select :'berr' = '' and :'b' = :'a'
           and (select count(*) = 1 and bool_and(mood = 'boring' and status = 'held') from public.check_ins where session_id = '$S_p1'),
         format('held check-ins in the session: %s (%s)', (select count(*) from public.check_ins where session_id = '$S_p1'),
           (select string_agg(mood || '/' || status, ', ') from public.check_ins where session_id = '$S_p1'))"

# ── 3. Check-in writes vs. delivery ───────────────────────────────────────────────────────────
# "run_due_jobs first": A makes the check-in due inside its own transaction, which locks it, and then runs
# run_due_jobs, as a cron run holds a check-in from delivery until it commits. B is the website.
# "website first": the check-in is due and committed, so any run_due_jobs may pick it up; A is the website
# and holds it, B is a run_due_jobs.

race "3a undo_check_in while run_due_jobs delivers it" "" \
  "$DUE '$C_u1'; $RDJ; select status from public.check_ins where id = '$C_u1'" \
  "$(as_user u1) select (public.undo_check_in('$C_u1')).status"
verdict "select :'berr' = 'This update was already sent. Delete it instead.'
           and (select status = 'delivered' from public.check_ins where id = '$C_u1')
           and (select count(*) = 1 from public.check_in_recipients where check_in_id = '$C_u1'),
         format('B: %s; check-in %s, %s recipient(s)', coalesce(nullif(:'berr', ''), :'b'),
           (select status from public.check_ins where id = '$C_u1'),
           (select count(*) from public.check_in_recipients where check_in_id = '$C_u1'))"

cron_gap 2
race "3b undo_check_in, then run_due_jobs reaches it" "$DUE '$C_u2';" \
  "$(as_user u2) select (public.undo_check_in('$C_u2')).status" "$RDJ"
verdict "select :'aerr' = '' and :'a' = 'undone'
           and (select status = 'undone' from public.check_ins where id = '$C_u2')
           and not exists (select 1 from public.check_in_recipients where check_in_id = '$C_u2'),
         format('undo said %s; check-in %s, %s recipient(s)', coalesce(nullif(:'aerr', ''), :'a'),
           (select status from public.check_ins where id = '$C_u2'),
           (select count(*) from public.check_in_recipients where check_in_id = '$C_u2'))"

race "3c set_check_in_audience (list, make default) while run_due_jobs delivers it" "" \
  "$DUE '$C_u3'; $RDJ; select status from public.check_ins where id = '$C_u3'" \
  "$(as_user u3) select (public.set_check_in_audience('$C_u3', 'list', '$L_u3', null, true)).status"
verdict "select :'berr' = 'This update was already sent, so its audience can''t change.'
           and (select audience_type = 'everyone' and status = 'delivered' from public.check_ins where id = '$C_u3')
           and (select count(*) = 2 and bool_and(audience_label = 'everyone') from public.check_in_recipients where check_in_id = '$C_u3')
           and (select default_list_id is null from public.user_settings where user_id = '$(prof u3)'),
         format('B: %s; audience %s to %s recipient(s); default list set: %s', coalesce(nullif(:'berr', ''), :'b'),
           (select audience_type from public.check_ins where id = '$C_u3'),
           (select count(*) from public.check_in_recipients where check_in_id = '$C_u3'),
           (select default_list_id is not null from public.user_settings where user_id = '$(prof u3)'))"

cron_gap 2
race "3d set_check_in_audience (list), then run_due_jobs reaches it" "$DUE '$C_u4';" \
  "$(as_user u4) select (public.set_check_in_audience('$C_u4', 'list', '$L_u4')).status" "$RDJ"
verdict "select :'aerr' = '' and :'a' = 'delivered'
           and (select array_agg(recipient_id) = array['$R2'::uuid] and bool_and(audience_label = 'just_for_you')
                from public.check_in_recipients where check_in_id = '$C_u4'),
         format('A: %s; recipients: %s', coalesce(nullif(:'aerr', ''), :'a'),
           (select string_agg(p.display_name || ' (' || r.audience_label || ')', ', ')
            from public.check_in_recipients r join public.profiles p on p.id = r.recipient_id where r.check_in_id = '$C_u4'))"

race "3e post_check_in replaces it while run_due_jobs delivers it" "" \
  "$DUE '$C_u5'; $RDJ; select status from public.check_ins where id = '$C_u5'" \
  "$(as_user u5) select (public.post_check_in('boring', 'today', 'race-e replaced')).id"
verdict "select :'berr' = 'You already checked in this session. Edit your update instead.'
           and (select status = 'delivered' and mood = 'fun' and text = 'race-e original' from public.check_ins where id = '$C_u5')
           and (select count(*) = 1 from public.check_ins where user_id = '$(prof u5)'),
         format('B: %s; check-ins: %s', coalesce(nullif(:'berr', ''), :'b'),
           (select string_agg(mood || '/' || status, ', ') from public.check_ins where user_id = '$(prof u5)'))"

cron_gap 2
race "3f post_check_in replaces it, then run_due_jobs reaches it" "$DUE '$C_u6';" \
  "$(as_user u6) select (public.post_check_in('boring', 'today', 'race-e replaced')).id" "$RDJ"
verdict "select :'aerr' = '' and :'a' = '$C_u6'
           and (select status = 'held' and mood = 'boring' and deliver_at > now() from public.check_ins where id = '$C_u6')
           and not exists (select 1 from public.check_in_recipients where check_in_id = '$C_u6'),
         format('check-in %s/%s, due in %s s', (select mood from public.check_ins where id = '$C_u6'),
           (select status from public.check_ins where id = '$C_u6'),
           (select round(extract(epoch from deliver_at - now())) from public.check_ins where id = '$C_u6'))"

# 3g: run_due_jobs reads its list of due check-ins once, then delivers them one by one. u7's check-in is
# on the list; while run_due_jobs is still busy with an earlier one (w0's, held up here by L locking its
# recipient), u7 posts again, which replaces the check-in and restarts its 30-second hold. deliver_check_in
# didn't look at deliver_at, so the replacement went out at once, and Undo said "already sent".
cron_gap 3
title "3g post_check_in replaces it after run_due_jobs listed it as due"
open L; open A; open B
run L "begin; select 1 from public.profiles where id = '$R3' for update;"
send A "$DUE '$C_u7'; begin; update public.check_ins set deliver_at = now() - interval '2 seconds' where id = '$C_w0'; $RDJ;"
A_STATE=$(settle A)
run B "begin; $(as_user u7) select (public.post_check_in('boring', 'today', 'race-e replaced')).deliver_at" b
run B "commit;"
run L "rollback;"
run A "select status || ' ' || coalesce(to_char(delivered_at, 'HH24:MI:SS.MS'), '-') from public.check_ins where id = '$C_u7'" a
run A "commit;"
close L; close A; close B
collect a b
echo "   A (run_due_jobs): ${A_STATE}, then u7's check-in: ${A_RES:-?}${A_ERR:+ ERROR: $A_ERR}"
echo "   B (post_check_in): new hold ends ${B_RES:-?}${B_ERR:+ ERROR: $B_ERR}"
verdict "select :'berr' = '' and (select status = 'held' and mood = 'boring' and deliver_at > now() from public.check_ins where id = '$C_u7')
           and not exists (select 1 from public.check_in_recipients where check_in_id = '$C_u7')
           and (select status = 'delivered' from public.check_ins where id = '$C_w0'),
         format('u7''s replacement is %s (delivered at %s, hold ends %s); w0''s is %s',
           (select status from public.check_ins where id = '$C_u7'),
           (select coalesce(to_char(delivered_at, 'HH24:MI:SS.MS'), '-') from public.check_ins where id = '$C_u7'),
           (select to_char(deliver_at, 'HH24:MI:SS.MS') from public.check_ins where id = '$C_u7'),
           (select status from public.check_ins where id = '$C_w0'))"

race "3h edit_check_in while run_due_jobs delivers it" "" \
  "$DUE '$C_u8'; $RDJ; select status from public.check_ins where id = '$C_u8'" \
  "$(as_user u8) select (public.edit_check_in('$C_u8', 'race-e edited')).status"
verdict "select :'berr' = '' and :'b' = 'delivered'
           and (select text = 'race-e edited' and edited_at is not null from public.check_ins where id = '$C_u8')
           and (select count(*) filter (where kind = 'check_in') = 1 and count(*) filter (where kind = 'edited') = 1
                from public.outbound_messages where user_id = '$R1' and check_in_id = '$C_u8'),
         format('B: %s; texts to r1: %s', coalesce(nullif(:'berr', ''), :'b'),
           (select string_agg(kind, ', ' order by id) from public.outbound_messages where user_id = '$R1' and check_in_id = '$C_u8'))"

cron_gap 2
race "3i edit_check_in, then run_due_jobs reaches it" "$DUE '$C_u9';" \
  "$(as_user u9) select (public.edit_check_in('$C_u9', 'race-e edited')).status" "$RDJ"
verdict "select :'aerr' = '' and :'a' = 'held'
           and (select status = 'held' and text = 'race-e edited' and edited_at is null from public.check_ins where id = '$C_u9')
           and not exists (select 1 from public.check_in_recipients where check_in_id = '$C_u9'),
         format('A: %s; check-in %s: %s', coalesce(nullif(:'aerr', ''), :'a'),
           (select status from public.check_ins where id = '$C_u9'), (select text from public.check_ins where id = '$C_u9'))"

race "3j delete_check_in while run_due_jobs delivers it" "" \
  "$DUE '$C_u10'; $RDJ; select status from public.check_ins where id = '$C_u10'" \
  "$(as_user u10) select public.delete_check_in('$C_u10')"
verdict "select :'berr' = '' and (select status = 'deleted' from public.check_ins where id = '$C_u10'),
         format('B: %s; check-in %s', coalesce(nullif(:'berr', ''), 'ok'), (select status from public.check_ins where id = '$C_u10'))"

cron_gap 2
race "3k delete_check_in, then run_due_jobs reaches it" "$DUE '$C_u11';" \
  "$(as_user u11) select public.delete_check_in('$C_u11')" "$RDJ"
verdict "select :'aerr' = '' and (select status = 'undone' from public.check_ins where id = '$C_u11')
           and not exists (select 1 from public.check_in_recipients where check_in_id = '$C_u11'),
         format('check-in %s, %s recipient(s)', (select status from public.check_ins where id = '$C_u11'),
           (select count(*) from public.check_in_recipients where check_in_id = '$C_u11'))"

# ── 4. run_due_jobs twice at once (cron and the website) ──────────────────────────────────────
# j1 brushes by text, so completing the session queues a DONE; its held check-in is due too.
cron_gap 2
race "4 run_due_jobs twice at once" \
  "update public.brush_sessions set ends_at = now() - interval '1 second' where id = '$S_j1'; $DUE '$C_j1';" \
  "$RDJ; select count(*) from public.outbound_messages where user_id = '$(prof j1)' and kind = 'done'" \
  "$RDJ" "$SKIP_DUE" "$SKIP_DUE"
verdict "select :'aerr' = '' and :'berr' = ''
           and (select count(*) = 1 from public.outbound_messages where user_id = '$(prof j1)' and kind = 'done')
           and (select count(*) = 1 from public.check_in_recipients where check_in_id = '$C_j1')
           and (select count(*) = 1 from public.outbound_messages where check_in_id = '$C_j1' and kind = 'check_in'),
         format('DONE texts: %s; recipients: %s; update texts: %s',
           (select count(*) from public.outbound_messages where user_id = '$(prof j1)' and kind = 'done'),
           (select count(*) from public.check_in_recipients where check_in_id = '$C_j1'),
           (select count(*) from public.outbound_messages where check_in_id = '$C_j1' and kind = 'check_in'))"

# ── 5. start_session / end_session vs. run_due_jobs completing the session ────────────────────
EXPIRE="update public.brush_sessions set ends_at = now() - interval '1 second' where id ="
done_count() { echo "(select count(*) from public.outbound_messages where user_id = '$(prof "$1")' and kind = 'done')"; }

race "5a end_session while run_due_jobs completes the session" "" \
  "$EXPIRE '$S_k1'; $RDJ; select status from public.brush_sessions where id = '$S_k1'" \
  "$(as_user k1) select coalesce((public.end_session('$S_k1')).status, 'no session')" "$SKIP_DUE" "$SKIP_DUE"
verdict "select :'berr' = '' and :'b' = 'no session' and $(done_count k1) = 1
           and (select status = 'completed' and ended_at = ends_at from public.brush_sessions where id = '$S_k1'),
         format('B: %s; DONE texts: %s', coalesce(nullif(:'berr', ''), :'b'), $(done_count k1))"

cron_gap 2
race "5b end_session, then run_due_jobs reaches the session" "$EXPIRE '$S_k2';" \
  "$(as_user k2) select (public.end_session('$S_k2')).status" "$RDJ" "$SKIP_DUE" "$SKIP_DUE"
verdict "select :'aerr' = '' and :'a' = 'completed' and $(done_count k2) = 0
           and (select status = 'completed' from public.brush_sessions where id = '$S_k2'),
         format('A: %s; DONE texts: %s (ended by hand: none, as before)', coalesce(nullif(:'aerr', ''), :'a'), $(done_count k2))"

cron_gap 2
race "5c start_session while run_due_jobs completes the old session" "$EXPIRE '$S_k3';" \
  "$RDJ; select status from public.brush_sessions where id = '$S_k3'" \
  "$(as_user k3) select (public.start_session()).id" "$SKIP_DUE" "$SKIP_DUE"
verdict "select :'berr' = '' and :'b' <> '$S_k3' and $(done_count k3) = 1
           and (select status = 'completed' from public.brush_sessions where id = '$S_k3')
           and (select count(*) = 1 from public.brush_sessions where user_id = '$(prof k3)' and status = 'active'),
         format('B: %s; DONE texts: %s', coalesce(nullif(:'berr', ''), 'a new session'), $(done_count k3))"

cron_gap 2
race "5d start_session, then run_due_jobs reaches the old session" "$EXPIRE '$S_k4';" \
  "$(as_user k4) select (public.start_session()).id" "$RDJ" "$SKIP_DUE" "$SKIP_DUE"
verdict "select :'aerr' = '' and :'a' <> '$S_k4' and $(done_count k4) = 0
           and (select status = 'completed' from public.brush_sessions where id = '$S_k4')
           and (select count(*) = 1 from public.brush_sessions where user_id = '$(prof k4)' and status = 'active'),
         format('A: %s; DONE texts: %s (start_session closes it quietly, as before)',
           coalesce(nullif(:'aerr', ''), 'a new session'), $(done_count k4))"

# ── 6. Two friends start brushing at once ─────────────────────────────────────────────────────
# fp gets at most one proactive "[🪥 BRUSHING NOW] … is brushing right now." a day. x1 and y1 both
# checked for one, found none (the other's was uncommitted), and both queued one.
race "6 x1 and y1 start at once; their friend fp gets one proactive text" "" \
  "$(as_user x1) select (public.start_session()).id" \
  "$(as_user y1) select (public.start_session()).id" "$SKIP_DUE" "$SKIP_DUE"
verdict "select :'aerr' = '' and :'berr' = ''
           and (select count(*) = 1 from public.outbound_messages where user_id = '$FP' and kind = 'presence_proactive'),
         format('proactive texts to fp: %s', (select count(*) from public.outbound_messages where user_id = '$FP' and kind = 'presence_proactive'))"

# ── 7, 8. Lock order ──────────────────────────────────────────────────────────────────────────
# Since 0011, post_check_in locks the session row and then the check-in it replaces. These two cases hold
# a check-in first and then need its session, which deadlocks unless the session lock is compatible.

# 7: v1 posts right at the 2:00 mark (B's transaction starts before the session ends), and a run that starts
# just after delivers v1's held check-in and then completes the session. B holds the session and waits for
# the check-in; run_due_jobs holds the check-in, so it must not wait for the session.
cron_gap 3.5
title "7 post_check_in at the 2:00 mark while run_due_jobs delivers its check-in and ends the session"
q -c "update public.brush_sessions set ends_at = clock_timestamp() + interval '1 second' where id = '$S_v1'"
open A; open B
run B "begin; $(as_user v1)"
sleep 1.2   # the session is over for transactions that start from now on
run A "begin; $DUE '$C_v1';"
send B "select (public.post_check_in('boring', 'today', 'race-e last second')).id" b
B_STATE=$(settle B)
run A "$RDJ; select status from public.check_ins where id = '$C_v1'" a
run A "commit;"
await B
run B "commit;"
close A; close B
collect a b
show
verdict "select :'aerr' = '' and :'berr' = 'You already checked in this session. Edit your update instead.'
           and (select status = 'delivered' from public.check_ins where id = '$C_v1'),
         format('A: %s; B: %s', coalesce(nullif(:'aerr', ''), 'ok'), coalesce(nullif(:'berr', ''), :'b'))"

# 8: u12 picks an audience in one tab while posting again in another. set_check_in_audience writes the
# check-in, then deliver_check_in writes it again, and that second write re-checks the session_id foreign
# key (KEY SHARE on the session). L holds up the delivery (it locks the recipient) so the post can take the
# session lock in between.
title "8 set_check_in_audience delivers while post_check_in (another tab) waits for the check-in"
open L; open A; open B
run L "begin; select 1 from public.profiles where id = '$R3' for update;"
send A "begin; $(as_user u12) select (public.set_check_in_audience('$C_u12', 'everyone')).status" a
A_STATE=$(settle A)
send B "begin; $(as_user u12) select (public.post_check_in('boring', 'today', 'race-e other tab')).id" b
B_STATE=$(settle B)
run L "rollback;"
await A
run A "commit;"
await B
run B "commit;"
close L; close A; close B
collect a b
echo "   A (set_check_in_audience): ${A_STATE}, then ${A_RES:-?}${A_ERR:+ ERROR: $A_ERR}"
echo "   B (post_check_in): ${B_STATE}, then ${B_RES:-ok}${B_ERR:+ ERROR: $B_ERR}"
verdict "select :'aerr' = '' and :'a' = 'delivered'
           and :'berr' = 'You already checked in this session. Edit your update instead.'
           and (select count(*) = 1 from public.check_in_recipients where check_in_id = '$C_u12'),
         format('A: %s; B: %s', coalesce(nullif(:'aerr', ''), :'a'), coalesce(nullif(:'berr', ''), :'b'))"

echo
if [ "$FAILS" -eq 0 ]; then echo "all session race cases passed"; else echo "$FAILS session race case(s) failed"; fi
exit $(( FAILS > 0 ))
