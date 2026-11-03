-- Direct invitations require recipient consent. Bearer links / Pick codes keep their
-- existing explicit accept/join behavior. Existing memberships are not changed.
create table public.group_invitations (
 id uuid primary key default gen_random_uuid(),
 group_id uuid not null references public.groups(id) on delete cascade,
 inviter_id uuid not null references public.profiles(id) on delete cascade,
 invitee_id uuid not null references public.profiles(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','accepted','declined')),
 created_at timestamptz not null default now(), resolved_at timestamptz,
 check(inviter_id<>invitee_id),
 check((status='pending')=(resolved_at is null))
);
create unique index group_invitations_one_pending on public.group_invitations(group_id,invitee_id) where status='pending';
create index group_invitations_recipient on public.group_invitations(invitee_id,created_at desc) where status='pending';
alter table public.group_invitations enable row level security;
revoke all on public.group_invitations from anon,authenticated;
grant select on public.group_invitations to authenticated;
grant all on public.group_invitations to service_role;

-- Used by API queries and RLS alike; blocked/removed friendships fail closed.
create function private.group_invitation_available(i public.group_invitations) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.groups g join public.group_members m on m.group_id=g.id
  where g.id=i.group_id and g.owner_id=i.inviter_id and m.user_id=i.inviter_id)
 and private.are_friends(i.inviter_id,i.invitee_id)
 and not private.is_blocked_between(i.inviter_id,i.invitee_id);
$$;
revoke all on function private.group_invitation_available(public.group_invitations) from public,anon;
grant execute on function private.group_invitation_available(public.group_invitations) to authenticated,service_role;
create policy group_invitations_relevant_read on public.group_invitations for select to authenticated
 using ((invitee_id=(select auth.uid()) or inviter_id=(select auth.uid()))
  and private.group_invitation_available(group_invitations));

create function private.group_invitation_json(i public.group_invitations) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('id',i.id,'groupId',i.group_id,'inviterId',i.inviter_id,'inviteeId',i.invitee_id,
  'status',i.status,'createdAt',i.created_at,'resolvedAt',i.resolved_at,
  'groupName',g.name,'inviterName',a.display_name,'inviteeName',b.display_name)
 from public.groups g join public.profiles a on a.id=i.inviter_id join public.profiles b on b.id=i.invitee_id where g.id=i.group_id;
$$;
revoke all on function private.group_invitation_json(public.group_invitations) from public,anon,authenticated;
grant execute on function private.group_invitation_json(public.group_invitations) to service_role;

-- The new RPC name fails closed if the API deploy precedes the migration.
create function public.group_invite_members(p_user_id uuid,p_group_id uuid,p_user_ids uuid[]) returns integer
language plpgsql set search_path='' as $$
declare n integer;
begin
 perform private.lock_group_as_owner(p_group_id,p_user_id);
 if p_user_ids is null or cardinality(p_user_ids) not between 1 and 25 or array_position(p_user_ids,null) is not null then
  raise exception using errcode='PT400',message='Expected 1 to 25 users',hint='invalid_invitees';
 end if;
 perform private.require_friends(p_user_id,p_user_ids);
 if exists(select 1 from unnest(p_user_ids) u where private.is_blocked_between(p_user_id,u)) then
  raise exception using errcode='PT403',message='Not friends',hint='not_friends';
 end if;
 if (select count(*) from public.group_members where group_id=p_group_id)>=25
 and exists(select 1 from unnest(p_user_ids) u where not exists(select 1 from public.group_members m where m.group_id=p_group_id and m.user_id=u)
  and not exists(select 1 from public.group_invitations i where i.group_id=p_group_id and i.invitee_id=u and i.status='pending')) then
  raise exception using errcode='PT409',message='Group full',hint='group_full';
 end if;
 insert into public.group_invitations(group_id,inviter_id,invitee_id)
 select p_group_id,p_user_id,u from (select distinct unnest(p_user_ids) u) users
 where u<>p_user_id and not exists(select 1 from public.group_members m where m.group_id=p_group_id and m.user_id=u)
 on conflict(group_id,invitee_id) where status='pending' do nothing;
 get diagnostics n=row_count;
 return n;
end $$;

-- Old callers also create requests; there is no direct-add bypass.
create or replace function public.group_add_members(p_user_id uuid,p_group_id uuid,p_user_ids uuid[]) returns integer
language sql set search_path='' as $$ select public.group_invite_members(p_user_id,p_group_id,p_user_ids); $$;

create function public.group_invitations_list(p_user_id uuid,p_group_id uuid default null) returns jsonb
language plpgsql set search_path='' as $$
declare result jsonb;
begin
 if p_group_id is not null then perform private.lock_group_as_owner(p_group_id,p_user_id); end if;
 select coalesce(jsonb_agg(private.group_invitation_json(i) order by i.created_at desc,i.id),'[]'::jsonb) into result
 from public.group_invitations i where i.status='pending'
 and (case when p_group_id is null then i.invitee_id=p_user_id else i.group_id=p_group_id end)
 and private.group_invitation_available(i)
 and not exists(select 1 from public.group_members m where m.group_id=i.group_id and m.user_id=i.invitee_id);
 return result;
end $$;

create function public.group_invitation_resolve(p_user_id uuid,p_invite_id uuid,p_decision text) returns jsonb
language plpgsql set search_path='' as $$
declare i public.group_invitations; g uuid;
begin
 if p_decision not in ('accepted','declined') or p_decision is null then raise exception using errcode='PT400',message='Invalid decision'; end if;
 -- All direct invite writes lock group first, then invite. Do not trust a body user ID.
 select group_id into g from public.group_invitations where id=p_invite_id and invitee_id=p_user_id;
 if not found then raise exception using errcode='PT404',message='Invitation not found'; end if;
 perform 1 from public.groups where id=g for update;
 select * into i from public.group_invitations where id=p_invite_id and invitee_id=p_user_id for update;
 if not found or not private.group_invitation_available(i) then raise exception using errcode='PT404',message='Invitation not found'; end if;
 if i.status<>'pending' then
  if i.status<>p_decision or (i.status='accepted' and not exists(select 1 from public.group_members where group_id=g and user_id=p_user_id)) then
   raise exception using errcode='PT409',message='Invitation is already resolved',hint='invite_resolved';
  end if;
  return private.group_invitation_json(i); -- successful retry; never re-add a removed member
 end if;
 if p_decision='accepted' and not exists(select 1 from public.group_members where group_id=g and user_id=p_user_id) then
  if (select count(*) from public.group_members where group_id=g)>=25 then raise exception using errcode='PT409',message='Group full',hint='group_full'; end if;
  insert into public.group_members(group_id,user_id) values(g,p_user_id);
  if not found then raise exception using errcode='PT404',message='Invitation not found'; end if; -- blocking trigger may skip insert
 end if;
 update public.group_invitations set status=p_decision,resolved_at=now() where id=i.id returning * into i;
 update public.notifications set read_at=coalesce(read_at,now()) where user_id=p_user_id and type='group_invite' and payload->>'inviteId'=i.id::text;
 return private.group_invitation_json(i);
end $$;
revoke all on function public.group_invite_members(uuid,uuid,uuid[]),public.group_add_members(uuid,uuid,uuid[]),public.group_invitations_list(uuid,uuid),public.group_invitation_resolve(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.group_invite_members(uuid,uuid,uuid[]),public.group_add_members(uuid,uuid,uuid[]),public.group_invitations_list(uuid,uuid),public.group_invitation_resolve(uuid,uuid,text) to service_role;

-- Reuse notify()/push transport. Payload stores only the invite ID, not private names.
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check(type in (
 'added_to_pick','pick_started','reminder','vote_needed','winner_decided','pick_canceled',
 'plan_time_set','plan_reminder','did_you_go','group_invite'));
create unique index notifications_once_per_group_invite on public.notifications(user_id,(payload->>'inviteId')) where type='group_invite';
alter function public.notify_insert(uuid[],text,uuid,jsonb) rename to notify_insert_before_group_invites;
alter function public.notify_insert_before_group_invites(uuid[],text,uuid,jsonb) set schema private;
create function public.notify_insert(p_user_ids uuid[],p_type text,p_pick_id uuid,p_payload jsonb) returns setof uuid
language plpgsql set search_path='' as $$ begin
 if p_type<>'group_invite' then
  return query select * from private.notify_insert_before_group_invites(p_user_ids,p_type,p_pick_id,p_payload);
 else
  return query insert into public.notifications(user_id,type,payload)
   select i.invitee_id,p_type,jsonb_build_object('inviteId',i.id)
   from public.group_invitations i where i.id=private.try_uuid(p_payload->>'inviteId')
    and i.invitee_id=any(p_user_ids) and i.status='pending' and private.group_invitation_available(i)
   on conflict do nothing returning user_id;
 end if;
end $$;
revoke all on function public.notify_insert(uuid[],text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.notify_insert(uuid[],text,uuid,jsonb) to service_role;
