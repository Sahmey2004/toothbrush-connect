-- Let a check-in be just a line of text, with no mood/emoji.
--
-- mood becomes optional. The inline `mood in (...)` CHECK already permits NULL (null → UNKNOWN,
-- which a CHECK passes), and post_check_in just stores p_mood, so dropping NOT NULL is enough on the
-- table side. The labelled message and the mood helpers drop the mood part when it's absent.

alter table public.check_ins alter column mood drop not null;

create or replace function public.mood_word(m text) returns text
language sql immutable set search_path = '' as $$
  select case m when 'fun' then 'FUN' when 'stressful' then 'STRESSFUL' when 'boring' then 'BORING'
                when 'just_okay' then 'JUST OKAY' else '' end
$$;

create or replace function public.mood_emoji(m text) returns text
language sql immutable set search_path = '' as $$
  select case m when 'fun' then '😄' when 'stressful' then '😣' when 'boring' then '😐'
                when 'just_okay' then '🙂' else '' end
$$;

-- With a mood: `[😄 FUN · today] Aisha: "…"`. Without one: `[today] Aisha: "…"`,
-- `[👥 CLOSE CIRCLE] …`, `[💌 JUST FOR YOU] …`.
create or replace function public.check_in_message(p_mood text, p_scope text, p_text text, p_label text, p_author text) returns text
language sql immutable set search_path = '' as $$
  select '[' || case p_label
      when 'everyone' then case when p_mood is null then ''
                                else public.mood_emoji(p_mood) || ' ' || public.mood_word(p_mood) || ' · ' end
                           || case p_scope when 'this_week' then 'this week' else 'today' end
      when 'close_circle' then '👥 CLOSE CIRCLE' || case when p_mood is null then '' else ' · ' || public.mood_word(p_mood) end
      else '💌 JUST FOR YOU' || case when p_mood is null then '' else ' · ' || public.mood_word(p_mood) end
    end || '] ' || p_author || coalesce(': "' || p_text || '"', '')
$$;
