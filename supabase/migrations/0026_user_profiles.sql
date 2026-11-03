-- New metadata is API-only. Existing basic-identity column grants / RLS stay intact.
alter table public.profiles
 add column username text check(username is null or username ~ '^[a-z0-9_]{3,24}$'),
 add column favorite_cuisine text check(char_length(favorite_cuisine)<=60),
 add column favorite_activity text check(char_length(favorite_activity)<=60),
 add column share_profile_metadata boolean not null default false;
create unique index profiles_username_unique on public.profiles(lower(username)) where username is not null;
-- Column grants are explicit (0011); do not grant new metadata to authenticated/anon.

create function public.user_profile_get(p_viewer_id uuid,p_target_id uuid) returns jsonb
language plpgsql stable set search_path='' as $$
declare p public.profiles; own boolean:=p_viewer_id=p_target_id; visible boolean; friends bigint; groups bigint; mutual jsonb:='[]';
begin
 if p_viewer_id is null or p_target_id is null then raise exception using errcode='PT404',message='Profile not found'; end if;
 select * into p from public.profiles where id=p_target_id;
 if not found or (not own and (not private.are_friends(p_viewer_id,p_target_id) or private.is_blocked_between(p_viewer_id,p_target_id))) then
  raise exception using errcode='PT404',message='Profile not found';
 end if;
 visible:=own or p.share_profile_metadata;
 if visible then
  select count(*) into friends from public.friendships f where f.status='accepted'
   and (f.requester_id=p_target_id or f.addressee_id=p_target_id)
   and not private.is_blocked_between(f.requester_id,f.addressee_id);
  select count(*) into groups from public.group_members where user_id=p_target_id;
  if not own then
   select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'name',g.name) order by g.name,g.id),'[]') into mutual
   from public.groups g join public.group_members a on a.group_id=g.id and a.user_id=p_viewer_id
    join public.group_members b on b.group_id=g.id and b.user_id=p_target_id;
  end if;
 end if;
 return jsonb_build_object('id',p.id,'displayName',p.display_name,'username',p.username,'avatarUrl',p.avatar_url,
  'isOwner',own,'metadataVisible',visible,'friendsCount',friends,'groupsCount',groups,
  'favoriteCuisine',case when visible then p.favorite_cuisine end,
  'favoriteActivity',case when visible then p.favorite_activity end,'mutualGroups',mutual)
  ||case when own then jsonb_build_object('shareMetadata',p.share_profile_metadata) else '{}'::jsonb end;
end $$;
create function public.user_profile_update(p_user_id uuid,p_input jsonb) returns jsonb
language plpgsql set search_path='' as $$
begin
 if jsonb_typeof(p_input) is distinct from 'object' or jsonb_typeof(p_input->'shareMetadata') is distinct from 'boolean'
  or (p_input ? 'username' and jsonb_typeof(p_input->'username') not in ('string','null'))
  or (p_input ? 'favoriteCuisine' and jsonb_typeof(p_input->'favoriteCuisine') not in ('string','null'))
  or (p_input ? 'favoriteActivity' and jsonb_typeof(p_input->'favoriteActivity') not in ('string','null')) then
  raise exception using errcode='PT400',message='Invalid profile details';
 end if;
 update public.profiles set username=nullif(lower(btrim(p_input->>'username')),''),
  favorite_cuisine=nullif(btrim(p_input->>'favoriteCuisine'),''),favorite_activity=nullif(btrim(p_input->>'favoriteActivity'),''),
  share_profile_metadata=(p_input->>'shareMetadata')::boolean,updated_at=now() where id=p_user_id;
 if not found then raise exception using errcode='PT404',message='Profile not found'; end if;
 return public.user_profile_get(p_user_id,p_user_id);
exception when check_violation then raise exception using errcode='PT400',message='Invalid profile details';
end $$;
revoke all on function public.user_profile_get(uuid,uuid),public.user_profile_update(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.user_profile_get(uuid,uuid),public.user_profile_update(uuid,jsonb) to service_role;
