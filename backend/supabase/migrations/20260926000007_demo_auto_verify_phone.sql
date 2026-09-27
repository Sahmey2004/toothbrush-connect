-- DEMO: every number typed on the website counts as verified right away, without the "Verify 123456" text.
--
-- start_phone_verification still creates the code; this trigger then completes it as if the text had
-- arrived from that number, so everything else stays the same: the number is linked to the account, a guest
-- profile for it merges in, get_me reports the phone, and the agent adds it to Photon's Users and sends the
-- welcome text.
--
-- After the demo, restore verification by text with:
--   drop trigger demo_auto_verify_phone on public.phone_verifications;

create function public.demo_auto_verify_phone() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.complete_phone_verification('imessage', new.phone, new.code);
  return null;
end $$;

revoke all on function public.demo_auto_verify_phone() from public, anon, authenticated;

create trigger demo_auto_verify_phone
  after insert or update on public.phone_verifications
  for each row when (new.verified_at is null)
  execute function public.demo_auto_verify_phone();
