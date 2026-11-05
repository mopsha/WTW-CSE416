-- Reuse 0026's case-insensitive unique index; do not rebuild or rename existing handles.
create function private.normalize_profile_username() returns trigger
language plpgsql set search_path='' as $$ begin
 if new.username is not null and (tg_op='INSERT' or new.username is distinct from old.username) then
  new.username:=lower(btrim(new.username));
  if new.username !~ '^[a-z0-9_]{3,24}$' or new.username in ('admin','administrator','support','moderator','wtw','official','system') then
   raise exception using errcode='PT400',message='Invalid or reserved username';
  end if;
 end if;
 return new;
end $$;
revoke all on function private.normalize_profile_username() from public,anon,authenticated;
create trigger normalize_profile_username before insert or update of username on public.profiles
 for each row execute function private.normalize_profile_username();

alter table public.rate_limit_counters drop constraint rate_limit_counters_scope_check;
alter table public.rate_limit_counters add constraint rate_limit_counters_scope_check
 check(scope in ('create','start','refresh','discover','avatar_read','avatar_resolve','username_lookup'));
create function private.username_lookup_limit(p_user_id uuid) returns void
language plpgsql set search_path='' as $$
declare n integer; bucket_now text:=to_char(now() at time zone 'UTC','YYYY-MM-DD HH24:MI'); begin
 if not exists(select 1 from public.profiles where id=p_user_id and not avatar_deletion_pending) then
  raise exception using errcode='PT404',message='Profile unavailable'; end if;
 delete from public.rate_limit_counters where scope='username_lookup' and subject=p_user_id::text
  and bucket<to_char((now()-interval '2 minutes') at time zone 'UTC','YYYY-MM-DD HH24:MI');
 insert into public.rate_limit_counters(scope,subject,bucket,calls) values('username_lookup',p_user_id::text,bucket_now,1)
 on conflict(scope,subject,bucket) do update set calls=public.rate_limit_counters.calls+1
 where public.rate_limit_counters.calls<30 returning calls into n;
 if n is null then raise exception using errcode='PT429',message='Too many profile searches. Try again shortly.'; end if;
end $$;
create function private.username_lookup_cleanup() returns trigger
language plpgsql security definer set search_path='' as $$ begin
 delete from public.rate_limit_counters where scope='username_lookup' and subject=old.id::text;
 return old;
end $$;
revoke all on function private.username_lookup_cleanup() from public,anon,authenticated;
create trigger username_lookup_cleanup after delete on public.profiles for each row execute function private.username_lookup_cleanup();

-- The only discoverable fields are identity and the viewer's own relationship.
create function private.person_identity(p_viewer uuid,p_target uuid) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('userId',p.id,'displayName',p.display_name,'username',p.username,
 'relationship',case when p.id=p_viewer then 'self' when f.status='accepted' then 'friends'
  when f.requester_id=p_viewer then 'requested' when f.addressee_id=p_viewer then 'incoming' else 'none' end)
 from public.profiles p left join public.friendships f
 on least(f.requester_id,f.addressee_id)=least(p_viewer,p_target) and greatest(f.requester_id,f.addressee_id)=greatest(p_viewer,p_target)
 where p.id=p_target and not p.avatar_deletion_pending and p.username is not null
 and not private.is_blocked_between(p_viewer,p_target);
$$;
create index profiles_username_discovery_idx on public.profiles(username text_pattern_ops) where username is not null;
create function public.username_search(p_user_id uuid,p_query text) returns jsonb
language plpgsql set search_path='' as $$ declare q text:=lower(regexp_replace(btrim(p_query),'^@','')); result jsonb; begin
 if q is null or q !~ '^[a-z0-9_]{3,24}$' then raise exception using errcode='PT400',message='Invalid username search'; end if;
 perform private.username_lookup_limit(p_user_id);
 select coalesce(jsonb_agg(item),'[]'::jsonb) into result from (
  select private.person_identity(p_user_id,p.id) item from public.profiles p
  where p.id<>p_user_id and not p.avatar_deletion_pending and not private.is_blocked_between(p_user_id,p.id)
  and p.username like (replace(q,'_',E'\\_')||'%') escape E'\\'
  order by p.username,p.id limit 10
 ) matches;
 return result;
end $$;
create function public.person_lookup(p_user_id uuid,p_target_id uuid) returns jsonb
language plpgsql set search_path='' as $$ declare result jsonb; begin
 perform private.username_lookup_limit(p_user_id);
 result:=private.person_identity(p_user_id,p_target_id);
 -- Return null (mapped to 404 by the API) so failed lookups still commit quota.
 return result;
end $$;
-- Username is a public identifier, not an email-discovery mechanism. Reuse the
-- canonical friend RPC/guards and verify its resolved UUID before committing.
create function private.username_request_email(p_target uuid) returns text
language sql stable security definer set search_path='' as $$ select email from auth.users where id=p_target; $$;
revoke all on function private.username_request_email(uuid) from public,anon,authenticated;
grant execute on function private.username_request_email(uuid) to service_role;
create function public.friend_request_username(p_user_id uuid,p_username text,p_target_id uuid) returns void
language plpgsql set search_path='' as $$ declare target uuid; result jsonb; email text; begin
 if p_username is null or p_username !~ '^[a-z0-9_]{3,24}$' then raise exception using errcode='PT400',message='Invalid username'; end if;
 select p.id,private.username_request_email(p.id) into target,email from public.profiles p
 where p.id=p_target_id and p.username=p_username and not p.avatar_deletion_pending;
 if target is null or target=p_user_id or private.is_blocked_between(p_user_id,target) then return; end if;
 if not exists(select 1 from public.profiles where id=p_user_id and not avatar_deletion_pending) then
  raise exception using errcode='PT404',message='Profile unavailable'; end if;
 result:=public.friend_request(p_user_id,email);
 if (result->>'userId')::uuid is distinct from target then raise exception using errcode='PT404',message='Profile unavailable'; end if;
end $$;
revoke all on function private.username_lookup_limit(uuid),private.person_identity(uuid,uuid),public.username_search(uuid,text),public.person_lookup(uuid,uuid),public.friend_request_username(uuid,text,uuid) from public,anon,authenticated;
grant execute on function private.username_lookup_limit(uuid),private.person_identity(uuid,uuid),public.username_search(uuid,text),public.person_lookup(uuid,uuid),public.friend_request_username(uuid,text,uuid) to service_role;
