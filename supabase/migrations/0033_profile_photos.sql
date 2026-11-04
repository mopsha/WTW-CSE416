-- Managed private photos. Legacy avatar_url remains backward compatible; never
-- put a private object URL or a bearer credential in that publicly readable column.
do $$ begin
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='storage' and c.relname in ('objects','buckets') and not c.relrowsecurity) then
  raise exception 'Storage RLS must be enabled before installing managed photos';
 end if;
end $$;
alter table public.profiles
 add column avatar_path text,
 add column avatar_revision bigint not null default 0 check (avatar_revision >= 0),
 add column avatar_deletion_pending boolean not null default false;
create unique index profiles_avatar_path_unique on public.profiles(avatar_path) where avatar_path is not null;

alter table public.rate_limit_events drop constraint rate_limit_events_action_check;
alter table public.rate_limit_events add constraint rate_limit_events_action_check
 check(action in ('friend_request','report','invite_create','message_send','avatar_upload'));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values ('profile-photos','profile-photos',false,1048576,array['image/jpeg'])
 on conflict(id) do update set public=false,file_size_limit=1048576,allowed_mime_types=array['image/jpeg'];
-- Restrictive policies also deny access if an unrelated permissive policy exists.
-- The service role bypasses RLS; all application access is through verified API calls.
create policy "managed photos: no direct client access" on storage.objects
 as restrictive for all to anon,authenticated
 using (bucket_id <> 'profile-photos') with check (bucket_id <> 'profile-photos');
create policy "managed photos: no client bucket changes" on storage.buckets
 as restrictive for all to anon,authenticated
 using (id <> 'profile-photos') with check (id <> 'profile-photos');

create function private.can_view_avatar(p_viewer uuid,p_target uuid) returns boolean
language sql stable set search_path='' as $$
 select exists(select 1 from public.profiles where id=p_viewer and not avatar_deletion_pending)
 and exists(select 1 from public.profiles where id=p_target and not avatar_deletion_pending)
 and not private.is_blocked_between(p_viewer,p_target)
 and (p_viewer=p_target or private.are_friends(p_viewer,p_target)
  or exists(select 1 from public.group_members a join public.group_members b using(group_id)
   where a.user_id=p_viewer and b.user_id=p_target)
  or exists(select 1 from public.pick_participants a join public.pick_participants b using(pick_id)
   where a.user_id=p_viewer and b.user_id=p_target));
$$;
revoke all on function private.can_view_avatar(uuid,uuid) from public,anon,authenticated;
grant execute on function private.can_view_avatar(uuid,uuid) to service_role;

-- Batch references avoid per-message/profile queries. Unauthorized and absent
-- photos are omitted, and no internal path is returned by this projection.
create function public.avatar_refs(p_viewer_id uuid,p_target_ids uuid[]) returns jsonb
language sql stable set search_path='' as $$
 select coalesce(jsonb_object_agg(p.id::text,jsonb_build_object('revision',p.avatar_revision,
  'avatarRef',case when p.avatar_path is null then null else jsonb_build_object('userId',p.id,'revision',p.avatar_revision) end)),'{}'::jsonb)
 from public.profiles p where p.id=any(p_target_ids)
 and private.can_view_avatar(p_viewer_id,p.id);
$$;

create function public.avatar_read(p_viewer_id uuid,p_target_id uuid,p_revision bigint) returns text
language plpgsql stable set search_path='' as $$
declare result text;
begin
 select avatar_path into result from public.profiles where id=p_target_id
 and avatar_revision=p_revision and private.can_view_avatar(p_viewer_id,p_target_id);
 if result is null then raise exception using errcode='PT404',message='Photo unavailable'; end if;
 return result;
end $$;

-- Preflight is cheap and runs before decoding or uploading. The mutation below
-- repeats these checks while holding the profile row lock.
create function public.avatar_prepare(p_user_id uuid,p_revision bigint) returns void
language plpgsql set search_path='' as $$
declare p public.profiles;
begin
 if p_revision is null or p_revision<0 then raise exception using errcode='PT400',message='Invalid photo revision'; end if;
 select * into p from public.profiles where id=p_user_id for update;
 if not found then raise exception using errcode='PT404',message='Photo unavailable'; end if;
 if p.avatar_deletion_pending or p.avatar_revision<>p_revision then
  raise exception using errcode='PT409',message='Photo changed';
 end if;
 if (select count(*) from public.rate_limit_events where user_id=p_user_id and action='avatar_upload'
  and created_at>now()-interval '24 hours')>=20 then
  raise exception using errcode='PT429',message='Too many photo uploads';
 end if;
 insert into public.rate_limit_events(user_id,action) values(p_user_id,'avatar_upload');
end $$;

create function public.avatar_change(p_user_id uuid,p_revision bigint,p_path text) returns jsonb
language plpgsql set search_path='' as $$
declare p public.profiles; old_path text;
begin
 if p_revision is null or p_revision<0 then raise exception using errcode='PT400',message='Invalid photo revision'; end if;
 select * into p from public.profiles where id=p_user_id for update;
 if not found then raise exception using errcode='PT404',message='Photo unavailable'; end if;
 if p.avatar_deletion_pending or p.avatar_revision<>p_revision then
  raise exception using errcode='PT409',message='Photo changed';
 end if;
 if p_path is not null then
  if p_path !~ ('^'||p_user_id::text||'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$')
   or not exists(select 1 from storage.objects where bucket_id='profile-photos' and name=p_path
    and created_at>clock_timestamp()-interval '15 minutes') then
   raise exception using errcode='PT400',message='Invalid photo object';
  end if;
 end if;
 old_path:=p.avatar_path;
 update public.profiles set avatar_path=p_path,avatar_revision=avatar_revision+1,
  avatar_url=null,updated_at=now() where id=p_user_id returning * into p;
 return jsonb_build_object('previousPath',old_path,'revision',p.avatar_revision,
  'avatarRef',case when p_path is null then null else jsonb_build_object('userId',p.id,'revision',p.avatar_revision) end);
end $$;

create function public.avatar_begin_account_delete(p_user_id uuid) returns void
language plpgsql set search_path='' as $$
begin
 update public.profiles set avatar_deletion_pending=true,avatar_revision=avatar_revision+1
 where id=p_user_id and not avatar_deletion_pending;
end $$;

-- Recent objects cannot be collected. Commits only accept objects younger than
-- 15 minutes, so an old orphan can never become active while cleanup runs.
create function public.avatar_orphans() returns setof text
language sql stable set search_path='' as $$
 select o.name from storage.objects o where o.bucket_id='profile-photos'
 and o.created_at<now()-interval '24 hours'
 and not exists(select 1 from public.profiles p where p.avatar_path=o.name)
 order by o.created_at,o.name limit 100;
$$;

revoke all on function public.avatar_refs(uuid,uuid[]),public.avatar_read(uuid,uuid,bigint),
 public.avatar_prepare(uuid,bigint),public.avatar_change(uuid,bigint,text),
 public.avatar_begin_account_delete(uuid),public.avatar_orphans() from public,anon,authenticated;
grant execute on function public.avatar_refs(uuid,uuid[]),public.avatar_read(uuid,uuid,bigint),
 public.avatar_prepare(uuid,bigint),public.avatar_change(uuid,bigint,text),
 public.avatar_begin_account_delete(uuid),public.avatar_orphans() to service_role;
