-- Text-to-verify replaces saving a number directly (set_my_phone, migration 0013).
--
-- A number becomes someone's iMessage address only once they text "Verify 123456" from it
-- (start_phone_verification and complete_phone_verification, migration 0006). The text proves the number, and
-- it unlocks Photon: shared lines only message numbers that texted them first, so numbers saved without texting
-- in never got anything ("Target not allowed for this project"). The agent registers each number that is
-- waiting to be verified with Photon and records the user's line on phone_verifications, so the website can
-- open Messages addressed to it.
--
-- set_my_phone stays for removing your number (an empty value); any other value is refused.
create or replace function public.set_my_phone(p_phone text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public.require_me();
begin
  if nullif(trim(coalesce(p_phone, '')), '') is not null then
    raise exception 'To add a number, text us the code from it.';
  end if;

  delete from public.channel_identities where user_id = v_me and channel = 'imessage';
  -- Expire rather than delete a verification that is still waiting, so its attempt count keeps counting.
  update public.phone_verifications set expires_at = now() where user_id = v_me and verified_at is null;
  return public.get_me();
end $$;
