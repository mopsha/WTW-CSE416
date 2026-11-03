-- Existing accounts never repeat optional onboarding. New accounts can resume it.
-- This is an offer/dismiss marker, not an access-control/onboarding-complete flag.
alter table public.profiles add column optional_setup_pending boolean not null default false;
alter table public.profiles alter column optional_setup_pending set default true;
-- No client column grants: private state is accessed through the authenticated API.
create function public.user_identity_update(p_user_id uuid, p_input jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare n text := btrim(p_input->>'displayName'); u text := lower(btrim(p_input->>'username'));
begin
 if jsonb_typeof(p_input) is distinct from 'object'
  or jsonb_typeof(p_input->'displayName') is distinct from 'string'
  or jsonb_typeof(p_input->'username') is distinct from 'string'
  or n is null or char_length(n) not between 1 and 50 or n ~ '[[:cntrl:]]'
  or u is null or u !~ '^[a-z0-9_]{3,24}$' then
  raise exception using errcode='PT400',message='Invalid identity';
 end if;
 -- One write: a username conflict cannot leave a partially changed display name.
 -- Missing legacy profile rows can be repaired; they do not repeat new-account setup.
 insert into public.profiles(id,display_name,username,optional_setup_pending)
 values(p_user_id,n,u,false)
 on conflict(id) do update set display_name=excluded.display_name,username=excluded.username,updated_at=now();
 return public.user_profile_get(p_user_id,p_user_id);
end $$;
revoke all on function public.user_identity_update(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.user_identity_update(uuid,jsonb) to service_role;
