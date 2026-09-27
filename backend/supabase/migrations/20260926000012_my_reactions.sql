-- Replies and reactions to your updates, for the website.
--
-- react_as saves replies and reactions in public.reactions and queues an iMessage to the author,
-- but the website had no way to show them: the table only holds ids, and profiles are private.
-- get_my_reactions returns what friends sent you, with their name and the update it was about.

create function public.get_my_reactions(p_days int default 14)
returns table (
  id            uuid,
  from_user     uuid,
  from_name     text,
  kind          text,
  text          text,
  check_in_id   uuid,
  check_in_mood text,
  check_in_text text,
  created_at    timestamptz
)
language sql stable security definer set search_path = '' as $$
  select r.id, r.from_user, p.display_name, r.kind, r.text,
         r.check_in_id, c.mood, c.text, r.created_at
  from public.reactions r
  join public.profiles p on p.id = r.from_user
  left join public.check_ins c on c.id = r.check_in_id and c.user_id = r.to_user
  where r.to_user = public.require_me()
    and r.created_at > now() - make_interval(days => least(greatest(coalesce(p_days, 14), 1), 60))
    -- nothing from people you've blocked or who blocked you
    and not exists (
      select 1 from public.friendships f
      where f.user_a = least(r.from_user, r.to_user) and f.user_b = greatest(r.from_user, r.to_user)
        and f.status = 'blocked'
    )
  order by r.created_at desc
  limit 100
$$;

revoke execute on function public.get_my_reactions(int) from public, anon;
grant execute on function public.get_my_reactions(int) to authenticated;
