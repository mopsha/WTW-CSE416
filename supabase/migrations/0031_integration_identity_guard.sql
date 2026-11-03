-- 0027 made username part of required identity. Preserve legacy nullable rows,
-- but never let a metadata/privacy edit erase an established required username.
alter function public.user_profile_update(uuid,jsonb) rename to user_profile_update_before_identity_guard;
alter function public.user_profile_update_before_identity_guard(uuid,jsonb) set schema private;
create function public.user_profile_update(p_user_id uuid,p_input jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare existing_username text;
begin
 select username into existing_username from public.profiles where id=p_user_id for update;
 if not found then raise exception using errcode='PT404',message='Profile not found'; end if;
 if existing_username is not null and nullif(btrim(p_input->>'username'),'') is null then
  raise exception using errcode='PT400',message='Username is required';
 end if;
 return private.user_profile_update_before_identity_guard(p_user_id,p_input);
end $$;
revoke all on function public.user_profile_update(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.user_profile_update(uuid,jsonb) to service_role;
