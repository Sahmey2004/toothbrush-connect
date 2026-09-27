-- Brushing sessions and check-ins under concurrency. The website (as the signed-in user) and the pg_cron job
-- call these at the same time, under READ COMMITTED, and the website and the agent also call run_due_jobs
-- themselves. Four real races:
--   - start_session twice at once (a double-click, two tabs): both found no active session, and the second
--     insert failed on one_active_session_per_user, so the website showed a database error
--   - the first two post_check_in calls of a session: neither had a held check-in to lock yet, so both
--     inserted one and friends got two updates from one session
--   - run_due_jobs reads its list of due check-ins once and then delivers them one by one. A check-in that
--     post_check_in replaced in the meantime (which restarts its 30-second hold) was still delivered at
--     once, so Undo said "already sent" during the hold the website had just shown
--   - two friends starting at once both found no proactive "[🪥 BRUSHING NOW]" text sent to a friend today,
--     and both queued one (the limit is one a day)
--
-- Already safe, and unchanged: undo_check_in, delete_check_in, edit_check_in and set_check_in_audience lock
-- the check-in row with their UPDATE, and deliver_check_in locks it with FOR UPDATE SKIP LOCKED. Whichever
-- is second waits (or skips) and then re-checks the committed row: an undo after delivery is told "already
-- sent", an audience change after delivery raises and changes nothing (not the default list either),
-- delivery after an undo finds nothing held, and deliver_check_in always reads the latest audience.
-- run_due_jobs against itself: a check-in or session is handled by whichever run locks it first; the other
-- skips it or re-checks status and finds it done, so there is one delivery and one DONE. end_session and
-- start_session against run_due_jobs: the same row lock and re-check.
--
-- Lock order. post_check_in now locks the session row (FOR NO KEY UPDATE) and then the check-in it replaces.
-- Anything that holds a check-in and then needs its session could deadlock with that, so:
--   - run_due_jobs locks check-ins (delivering) and then sessions (completing). If it waited for a session
--     row, a post at the 2:00 mark that holds the session and waits for the check-in run_due_jobs is
--     delivering would deadlock. It now waits for no check-in or session row: it skips rows others hold,
--     and the next run (5 s) picks them up.
--   - set_check_in_audience writes the check-in and then (deliver_check_in) writes it again, and the second
--     write re-checks the session_id foreign key, taking KEY SHARE on the session. NO KEY UPDATE doesn't
--     conflict with KEY SHARE, so that goes through while a post holds the session.
--   - undo_check_in, delete_check_in and edit_check_in write the check-in once and never touch sessions.
-- end_session and start_session lock no check-ins. The per-friend presence locks are taken in friend id
-- order and only by notify_presence, so two starts can't deadlock on them either.
--
-- Function bodies are copied from their latest migration (0002, 0004); only the commented parts change.
-- Safe to run again.

-- ── Sessions ──────────────────────────────────────────────────────────────────────────────────

-- FR-P1 / FR-P3: tell friends in the presence audience. Web readers get this through Realtime on
-- brush_sessions (RLS-filtered); messaging readers get a [🪥 BRUSHING NOW] text.
create or replace function public.notify_presence(p_owner uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
  v_friend uuid;
begin
  select display_name into v_name from public.profiles where id = p_owner;
  -- In id order, so two people starting at once take the per-friend locks below in the same order.
  for v_friend in
    select f from public.accepted_friend_ids(p_owner) f where public.in_presence_audience(p_owner, f) order by f
  loop
    if exists (select 1 from public.brush_sessions where user_id = v_friend and status = 'active' and ends_at > now()) then
      perform public.enqueue_message(v_friend, 'presence', '[🪥 BRUSHING NOW] ' || v_name || ' is brushing too 👋', null, null, false);
    elsif public.next_send_time(v_friend) <= now() then
      -- The lock makes the one-a-day check and the text one step when two friends start at once.
      perform public.xact_lock('presence:' || v_friend);
      if not exists (
        select 1 from public.outbound_messages
        where user_id = v_friend and kind = 'presence_proactive' and created_at > now() - interval '1 day'
      ) then
        perform public.enqueue_message(v_friend, 'presence_proactive', '[🪥 BRUSHING NOW] ' || v_name || ' is brushing right now.', null, null, true);
      end if;
    end if;
  end loop;
end $$;

create or replace function public.start_session(p_channel text default 'web') returns public.brush_sessions
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public.require_me();
  v_s public.brush_sessions;
begin
  update public.brush_sessions set status = 'completed', ended_at = ends_at
  where user_id = v_me and status = 'active' and ends_at <= now();

  -- Insert first: two starts at once both found no active session and the second insert failed on
  -- one_active_session_per_user. The second now waits for the first one's row and returns it, without
  -- telling friends again.
  loop
    insert into public.brush_sessions (user_id, channel) values (v_me, p_channel)
    on conflict (user_id) where status = 'active' do nothing
    returning * into v_s;
    if found then
      perform public.notify_presence(v_me);
      return v_s;
    end if;

    select * into v_s from public.brush_sessions where user_id = v_me and status = 'active';
    if found then
      return v_s;  -- idempotent per user
    end if;
    -- Ended between the insert and the select: try again.
  end loop;
end $$;

-- ── Check-ins ─────────────────────────────────────────────────────────────────────────────────

-- FR-C1..C3, FR-C6, FR-R1, FR-R2, FR-R4: create a held check-in (or replace this session's held one).
create or replace function public.post_check_in(
  p_mood text, p_scope text default 'today', p_text text default null,
  p_audience_type text default null, p_list_id uuid default null, p_friend_ids uuid[] default null
) returns public.check_ins
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public.require_me();
  v_session uuid;
  v_text text := left(nullif(trim(p_text), ''), 140);
  v_type text := p_audience_type;
  v_list uuid := p_list_id;
  v_c public.check_ins;
begin
  if v_type is null then
    select case when default_list_id is null then 'everyone' else 'list' end, default_list_id
    into v_type, v_list
    from public.user_settings where user_id = v_me;
  end if;
  if v_type = 'everyone' then v_list := null; end if;
  perform public.validate_audience(v_me, v_type, v_list, p_friend_ids);

  -- Lock the session: on the first post there is no check-in yet, so `for update` below locked nothing
  -- and two first posts both inserted one. A second post now waits for the first and replaces its
  -- check-in. Session before check-in; see the lock order at the top. NO KEY UPDATE, not UPDATE: writing
  -- a check-in row twice in one transaction (set_check_in_audience, then deliver_check_in) re-checks its
  -- session_id foreign key, which takes KEY SHARE on the session while holding the check-in.
  -- Posts outside a session take no lock: each one is a separate update whether they come one after
  -- another or at once, so a lock wouldn't change the result.
  select id into v_session from public.brush_sessions
  where user_id = v_me and status = 'active' and ends_at > now()
  for no key update;

  if v_session is not null then
    select * into v_c from public.check_ins
    where session_id = v_session and status in ('held', 'delivered')
    order by created_at desc limit 1 for update;
    if found and v_c.status = 'delivered' then
      raise exception 'You already checked in this session. Edit your update instead.';
    elsif found then
      update public.check_ins
      set mood = p_mood, scope = coalesce(p_scope, 'today'), text = v_text,
          audience_type = v_type, list_id = v_list,
          friend_ids = case when v_type = 'custom' then p_friend_ids else '{}' end,
          deliver_at = now() + interval '30 seconds'
      where id = v_c.id
      returning * into v_c;
      return v_c;
    end if;
  end if;

  insert into public.check_ins (user_id, session_id, mood, scope, text, audience_type, list_id, friend_ids)
  values (v_me, v_session, p_mood, coalesce(p_scope, 'today'), v_text, v_type, v_list,
          case when v_type = 'custom' then p_friend_ids else '{}' end)
  returning * into v_c;
  update public.profiles set status = 'active' where id = v_me and status = 'guest';
  return v_c;
end $$;

-- ── Scheduler ─────────────────────────────────────────────────────────────────────────────────

-- 30 s delivery hold and 2:00 DONE (0004). Runs every 5 s via pg_cron; the website also calls it when a
-- hold or timer runs out, so several runs can overlap.
create or replace function public.run_due_jobs() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_s public.brush_sessions;
  v_n int;
begin
  for v_id in select id from public.check_ins where status = 'held' and deliver_at <= now() order by deliver_at loop
    -- Lock it and check it is still due. The list above was read before any of these rows were locked,
    -- and post_check_in may have replaced this check-in since, restarting its hold. deliver_check_in
    -- doesn't look at deliver_at (set_check_in_audience sends early on purpose), so the check is here.
    -- Skip it if someone else holds it, as deliver_check_in does.
    perform 1 from public.check_ins where id = v_id and status = 'held' and deliver_at <= now() for update skip locked;
    if found then
      perform public.deliver_check_in(v_id);
    end if;
  end loop;

  -- Skip sessions someone else holds rather than wait: end_session or start_session is closing it, or
  -- post_check_in holds it while it waits for a check-in this run may have locked above (see the lock order
  -- at the top). If it is still active, the next run completes it. NO KEY UPDATE, the lock the update takes:
  -- the KEY SHARE that writing a check-in takes on its session (the foreign-key check) is no reason to skip.
  for v_s in
    update public.brush_sessions set status = 'completed', ended_at = ends_at
    where id in (
      select id from public.brush_sessions
      where status = 'active' and ends_at <= now()
      for no key update skip locked
    )
    returning *
  loop
    if v_s.channel <> 'web' then
      select count(distinct c.user_id) into v_n
      from public.check_in_recipients r join public.check_ins c on c.id = r.check_in_id
      where r.recipient_id = v_s.user_id and c.status = 'delivered' and r.delivered_at > now() - interval '1 day';
      perform public.enqueue_message(v_s.user_id, 'done',
        '[🎉 DONE] 2 minutes up. You caught up with ' || v_n || case when v_n = 1 then ' friend.' else ' friends.' end,
        null, 'confetti', false);
    end if;
  end loop;
end $$;

-- create or replace keeps each function's existing grants.
