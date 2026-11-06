-- Additive review corrections; 0036 and earlier migration history remain unchanged.
alter table public.friendships add column username_requested boolean not null default false;
comment on column public.friendships.username_requested is 'An outgoing pending state is discoverable only after an explicit UUID-bound username request.';

create table private.username_lookup_events (
 user_id uuid not null references public.profiles(id) on delete cascade,
 created_at timestamptz not null default now()
);
create index username_lookup_events_user_time on private.username_lookup_events(user_id,created_at);
alter table private.username_lookup_events enable row level security;
revoke all on private.username_lookup_events from public,anon,authenticated;
grant select,insert,delete on private.username_lookup_events to service_role;
create or replace function private.username_lookup_limit(p_user_id uuid) returns void
language plpgsql set search_path='' as $$
declare n integer; bucket_now text:=to_char(now() at time zone 'UTC','YYYY-MM-DD HH24:MI'); begin
 if not exists(select 1 from public.profiles where id=p_user_id and not avatar_deletion_pending) then
  raise exception using errcode='PT404',message='Profile unavailable'; end if;
 perform pg_advisory_xact_lock(hashtextextended('wtw-username-lookup:'||p_user_id,0));
 delete from private.username_lookup_events where user_id=p_user_id and created_at<=now()-interval '24 hours';
 if (select count(*) from private.username_lookup_events where user_id=p_user_id)>=150 then
  raise exception using errcode='PT429',message='Discovery limit reached. Try again later.'; end if;
 delete from public.rate_limit_counters where scope='username_lookup' and subject=p_user_id::text
  and bucket<to_char((now()-interval '2 minutes') at time zone 'UTC','YYYY-MM-DD HH24:MI');
 insert into public.rate_limit_counters(scope,subject,bucket,calls) values('username_lookup',p_user_id::text,bucket_now,1)
 on conflict(scope,subject,bucket) do update set calls=public.rate_limit_counters.calls+1
 where public.rate_limit_counters.calls<30 returning calls into n;
 if n is null then raise exception using errcode='PT429',message='Discovery limit reached. Try again later.'; end if;
 insert into private.username_lookup_events(user_id) values(p_user_id);
end $$;

create or replace function private.person_identity(p_viewer uuid,p_target uuid) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('userId',p.id,'displayName',p.display_name,'username',p.username,
 'relationship',case when p.id=p_viewer then 'self' when f.status='accepted' then 'friends'
  when f.requester_id=p_viewer and f.username_requested then 'requested'
  when f.addressee_id=p_viewer then 'incoming' else 'none' end)
 from public.profiles p left join public.friendships f
 on least(f.requester_id,f.addressee_id)=least(p_viewer,p_target) and greatest(f.requester_id,f.addressee_id)=greatest(p_viewer,p_target)
 where p.id=p_target and not p.avatar_deletion_pending and p.username is not null
 and not private.is_blocked_between(p_viewer,p_target);
$$;
-- Changed result is additive at the HTTP boundary. Drop only this unapplied PR's RPC.
drop function public.friend_request_username(uuid,text,uuid);
create function public.friend_request_username(p_user_id uuid,p_username text,p_target_id uuid) returns jsonb
language plpgsql set search_path='' as $$
declare target public.profiles; row public.friendships; begin
 -- Lock both profiles in stable order, serializing username changes and deletion.
 perform 1 from public.profiles where id in (p_user_id,p_target_id) order by id for update;
 if not exists(select 1 from public.profiles where id=p_user_id and not avatar_deletion_pending) then
  raise exception using errcode='PT404',message='Profile unavailable'; end if;
 if p_target_id=p_user_id then raise exception using errcode='PT400',message='Cannot add yourself'; end if;
 -- Missing and blocked identities have the same failure, with no success acknowledgement.
 select * into target from public.profiles where id=p_target_id and username=p_username and not avatar_deletion_pending;
 if not found or private.is_blocked_between(p_user_id,p_target_id) then
  raise exception using errcode='PT404',message='Profile unavailable'; end if;
 select * into row from public.friendships where
 least(requester_id,addressee_id)=least(p_user_id,p_target_id) and
 greatest(requester_id,addressee_id)=greatest(p_user_id,p_target_id) for update;
 if row.status='accepted' then return jsonb_build_object('status','sent','relationship','friends'); end if;
 if row.requester_id=p_user_id and row.username_requested then
  return jsonb_build_object('status','sent','relationship','requested'); end if;
 if not private.rate_take(p_user_id,'friend_request') then
  raise exception using errcode='PT429',message='Too many friend requests today'; end if;
 if row.addressee_id=p_user_id then
  update public.friendships set status='accepted',accepted_at=now() where requester_id=row.requester_id and addressee_id=row.addressee_id;
  return jsonb_build_object('status','sent','relationship','friends');
 elsif row.requester_id=p_user_id then
  update public.friendships set username_requested=true where requester_id=p_user_id and addressee_id=p_target_id;
 else
  insert into public.friendships(requester_id,addressee_id,username_requested)
   values(p_user_id,p_target_id,true) returning * into row;
  if row.requester_id is null then raise exception using errcode='PT404',message='Profile unavailable'; end if;
 end if;
 return jsonb_build_object('status','sent','relationship','requested');
end $$;
revoke all on function public.friend_request_username(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.friend_request_username(uuid,text,uuid) to service_role;

-- BEFORE INSERT fires before ON CONFLICT takes its UPDATE path. Check the existing
-- owner row, so grandfathering also works for real upserts, not just UPDATE tests.
create or replace function private.normalize_profile_username() returns trigger
language plpgsql set search_path='' as $$ declare previous text; begin
 if tg_op='UPDATE' then
  if new.username is not distinct from old.username then return new; end if;
 else
  select username into previous from public.profiles where id=new.id;
  if found and new.username is not distinct from previous then return new; end if;
 end if;
 if new.username is not null then
  new.username:=lower(btrim(new.username));
  if new.username !~ '^[a-z0-9_]{3,24}$' or new.username in ('admin','administrator','support','moderator','wtw','official','system') then
   raise exception using errcode='PT400',message='Invalid or reserved username'; end if;
 end if;
 return new;
end $$;
