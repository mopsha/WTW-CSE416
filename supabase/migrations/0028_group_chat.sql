-- Group-only, plain-text chat. Members can read; only the API can write.
create table public.group_messages (
 id uuid primary key default gen_random_uuid(),
 group_id uuid not null references public.groups(id) on delete cascade,
 sender_id uuid not null references public.profiles(id) on delete cascade,
 body text not null check(char_length(body) between 1 and 1000 and body !~ '^[[:space:]]*$'),
 client_id text not null check(client_id ~ '^[a-zA-Z0-9_-]{8,100}$'),
 created_at timestamptz not null default clock_timestamp(),
 unique(sender_id,client_id)
);
create index group_messages_recent on public.group_messages(group_id,created_at desc,id desc);
create index group_messages_sender on public.group_messages(sender_id);
alter table public.group_messages enable row level security;
create function private.can_read_group_message(p_group_id uuid,p_sender_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select private.is_group_member(p_group_id) and not private.is_blocked_between((select auth.uid()),p_sender_id);
$$;
revoke all on function private.can_read_group_message(uuid,uuid) from public,anon;
grant execute on function private.can_read_group_message(uuid,uuid) to authenticated,service_role;
revoke all on public.group_messages from anon,authenticated;
grant select on public.group_messages to authenticated;
grant all on public.group_messages to service_role;
create policy group_messages_members on public.group_messages for select to authenticated
 using(private.can_read_group_message(group_id,sender_id));

-- Uses the same group lock as leave/remove/delete; never trusts client-provided sender IDs.
create function public.group_chat(p_action text,p_user_id uuid,p_group_id uuid,p_input jsonb default '{}')
returns jsonb language plpgsql set search_path='' as $$
declare m public.group_messages; result jsonb; recipients jsonb;
begin
 perform private.lock_group_as_member(p_group_id,p_user_id);
 if p_action='list' then
  select coalesce(jsonb_agg(x.value order by x.created_at,x.id),'[]') into result from (
   select msg.created_at,msg.id,jsonb_build_object('id',msg.id,'groupId',msg.group_id,'senderId',msg.sender_id,
    'senderName',p.display_name,'senderUsername',p.username,'senderAvatarUrl',p.avatar_url,
    'body',msg.body,'createdAt',msg.created_at) value
   from public.group_messages msg join public.profiles p on p.id=msg.sender_id
   where msg.group_id=p_group_id and not private.is_blocked_between(p_user_id,msg.sender_id)
   order by msg.created_at desc,msg.id desc limit 50
  ) x;
  return result;
 end if;
 if p_action is distinct from 'send' or jsonb_typeof(p_input) is distinct from 'object'
  or jsonb_typeof(p_input->'body') is distinct from 'string'
  or jsonb_typeof(p_input->'clientId') is distinct from 'string'
  or char_length(p_input->>'body') not between 1 and 1000
  or (p_input->>'body') ~ '^[[:space:]]*$'
  or (p_input->>'clientId') !~ '^[a-zA-Z0-9_-]{8,100}$' then
  raise exception using errcode='PT400',message='Invalid message';
 end if;
 insert into public.group_messages(group_id,sender_id,body,client_id)
 values(p_group_id,p_user_id,p_input->>'body',p_input->>'clientId')
 on conflict(sender_id,client_id) do nothing returning * into m;
 if not found then
  select * into m from public.group_messages where sender_id=p_user_id and client_id=p_input->>'clientId';
  if m.group_id<>p_group_id or m.body<>p_input->>'body' then
   raise exception using errcode='PT409',message='Retry ID already used for another message';
  end if;
 end if;
 select jsonb_build_object('id',m.id,'groupId',m.group_id,'senderId',m.sender_id,
  'senderName',p.display_name,'senderUsername',p.username,'senderAvatarUrl',p.avatar_url,
  'body',m.body,'createdAt',m.created_at) into result from public.profiles p where p.id=m.sender_id;
 select coalesce(jsonb_agg(g.user_id),'[]') into recipients from public.group_members g
  where g.group_id=p_group_id and g.user_id<>p_user_id and not private.is_blocked_between(p_user_id,g.user_id);
 return jsonb_build_object('message',result,'recipientIds',recipients);
end $$;
revoke all on function public.group_chat(text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.group_chat(text,uuid,uuid,jsonb) to service_role;

-- Reuse notify(), preserving its existing Pick and invitation behavior.
alter table public.notifications add column group_message_id uuid references public.group_messages(id) on delete cascade;
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check(type in (
 'added_to_pick','pick_started','reminder','vote_needed','winner_decided','pick_canceled',
 'plan_time_set','plan_reminder','did_you_go','group_invite','group_message'));
alter table public.notifications add constraint notifications_group_message_check
 check((type='group_message')=(group_message_id is not null));
create index notifications_group_message_id on public.notifications(group_message_id) where group_message_id is not null;
create unique index notifications_once_per_group_message on public.notifications(user_id,group_message_id) where type='group_message';
alter function public.notify_insert(uuid[],text,uuid,jsonb) rename to notify_insert_before_group_chat;
alter function public.notify_insert_before_group_chat(uuid[],text,uuid,jsonb) set schema private;
create function public.notify_insert(p_user_ids uuid[],p_type text,p_pick_id uuid,p_payload jsonb) returns setof uuid
language plpgsql set search_path='' as $$
declare m public.group_messages;
begin
 if p_type<>'group_message' then
  return query select * from private.notify_insert_before_group_chat(p_user_ids,p_type,p_pick_id,p_payload);
  return;
 end if;
 select * into m from public.group_messages where id=private.try_uuid(p_payload->>'messageId');
 if not found then return; end if;
 -- Sender and recipients must still belong. Generic payload contains no message/name text.
 perform private.lock_group_as_member(m.group_id,m.sender_id);
 return query insert into public.notifications(user_id,type,group_message_id,payload)
  select gm.user_id,'group_message',m.id,jsonb_build_object('groupId',m.group_id,'messageId',m.id)
  from public.group_members gm where gm.group_id=m.group_id and gm.user_id=any(p_user_ids)
   and gm.user_id<>m.sender_id and not private.is_blocked_between(m.sender_id,gm.user_id)
  on conflict do nothing returning user_id;
end $$;
revoke all on function public.notify_insert(uuid[],text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.notify_insert(uuid[],text,uuid,jsonb) to service_role;
-- Existing Realtime infrastructure; fallback polling works when publication isn't available.
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table public.group_messages;
 end if;
end $$;
