-- The Photon agent (backend/src/agent, see docs/PLAN.md) drains the outbox with claim_outbound, so the database
-- no longer calls an edge function to drain the outbox.

create or replace function public.run_due_jobs() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_s public.brush_sessions;
  v_n int;
begin
  for v_id in select id from public.check_ins where status = 'held' and deliver_at <= now() order by deliver_at loop
    perform public.deliver_check_in(v_id);
  end loop;

  for v_s in
    update public.brush_sessions set status = 'completed', ended_at = ends_at
    where status = 'active' and ends_at <= now()
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

drop function public.invoke_agent_dispatch();
