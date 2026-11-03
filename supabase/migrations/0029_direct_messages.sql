-- Accepted-friend-only direct conversations. Unfriend/block revokes access, retaining history.
create table public.direct_conversations (
 id uuid primary key default gen_random_uuid(),
 user_low uuid not null references public.profiles(id) on delete cascade,
 user_high uuid not null references public.profiles(id) on delete cascade,
 created_at timestamptz not null default clock_timestamp(),
 check(user_low<user_high), unique(user_low,user_high)
);
create index direct_conversations_high on public.direct_conversations(user_high);
create table public.direct_messages (
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid not null references public.direct_conversations(id) on delete cascade,
 sender_id uuid not null references public.profiles(id) on delete cascade,
 body text not null check(char_length(body) between 1 and 1000 and body !~ '^[[:space:]]*$'),
 client_id text not null check(client_id ~ '^[a-zA-Z0-9_-]{8,100}$'),
 created_at timestamptz not null default clock_timestamp(),
 unique(sender_id,client_id)
);
create index direct_messages_recent on public.direct_messages(conversation_id,created_at desc,id desc);
create index direct_messages_sender on public.direct_messages(sender_id);

create function private.can_read_direct_conversation(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.direct_conversations c
  where c.id=p_id and (select auth.uid()) in (c.user_low,c.user_high)
   and private.are_friends(c.user_low,c.user_high) and not private.is_blocked_between(c.user_low,c.user_high));
$$;
revoke all on function private.can_read_direct_conversation(uuid) from public,anon;
grant execute on function private.can_read_direct_conversation(uuid) to authenticated,service_role;
alter table public.direct_conversations enable row level security;
alter table public.direct_messages enable row level security;
revoke all on public.direct_conversations,public.direct_messages from anon,authenticated;
grant select on public.direct_conversations,public.direct_messages to authenticated;
grant all on public.direct_conversations,public.direct_messages to service_role;
create policy direct_conversations_friends on public.direct_conversations for select to authenticated
 using(private.can_read_direct_conversation(id));
create policy direct_messages_friends on public.direct_messages for select to authenticated
 using(private.can_read_direct_conversation(conversation_id));

-- Profile locks protect account availability; the friendship lock serializes against
-- existing unfriend/block writes without changing those systems. All DM actions share this order.
create function private.lock_direct_pair(p_a uuid,p_b uuid) returns void
language plpgsql set search_path='' as $$
declare n integer;
begin
 if p_a is null or p_b is null or p_a=p_b then raise exception using errcode='PT404',message='Conversation unavailable'; end if;
 perform id from public.profiles where id in (p_a,p_b) order by id for key share;
 get diagnostics n=row_count;
 if n<>2 then raise exception using errcode='PT404',message='Conversation unavailable'; end if;
 perform 1 from public.friendships where least(requester_id,addressee_id)=least(p_a,p_b)
  and greatest(requester_id,addressee_id)=greatest(p_a,p_b) and status='accepted' for update;
 if not found or private.is_blocked_between(p_a,p_b) then raise exception using errcode='PT404',message='Conversation unavailable'; end if;
end $$;
revoke all on function private.lock_direct_pair(uuid,uuid) from public,anon,authenticated;
grant execute on function private.lock_direct_pair(uuid,uuid) to service_role;

create function public.direct_chat(p_action text,p_user_id uuid,p_target_id uuid,p_input jsonb default '{}') returns jsonb
language plpgsql set search_path='' as $$
declare c public.direct_conversations; m public.direct_messages; peer uuid; conversation jsonb; result jsonb;
begin
 if p_action='open' then
  peer:=p_target_id;
  perform private.lock_direct_pair(p_user_id,peer);
  insert into public.direct_conversations(user_low,user_high) values(least(p_user_id,peer),greatest(p_user_id,peer))
   on conflict(user_low,user_high) do nothing;
  select * into c from public.direct_conversations where user_low=least(p_user_id,peer) and user_high=greatest(p_user_id,peer) for update;
 else
  select * into c from public.direct_conversations where id=p_target_id;
  if not found or p_user_id is null or p_user_id not in (c.user_low,c.user_high) then raise exception using errcode='PT404',message='Conversation unavailable'; end if;
  peer:=case when p_user_id=c.user_low then c.user_high else c.user_low end;
  perform private.lock_direct_pair(p_user_id,peer);
  perform 1 from public.direct_conversations where id=c.id for update;
  if not found then raise exception using errcode='PT404',message='Conversation unavailable'; end if;
 end if;
 select jsonb_build_object('id',c.id,'createdAt',c.created_at,'peer',jsonb_build_object('id',p.id,
  'displayName',p.display_name,'username',p.username,'avatarUrl',p.avatar_url)) into conversation from public.profiles p where p.id=peer;
 if p_action='open' then return conversation; end if;
 if p_action='list' then
  select coalesce(jsonb_agg(x.value order by x.created_at,x.id),'[]') into result from (
   select msg.id,msg.created_at,jsonb_build_object('id',msg.id,'conversationId',msg.conversation_id,'senderId',msg.sender_id,
    'senderName',p.display_name,'senderUsername',p.username,'senderAvatarUrl',p.avatar_url,'body',msg.body,'createdAt',msg.created_at) value
   from public.direct_messages msg join public.profiles p on p.id=msg.sender_id
   where msg.conversation_id=c.id order by msg.created_at desc,msg.id desc limit 50
  ) x;
  return jsonb_build_object('conversation',conversation,'messages',result);
 end if;
 if p_action is distinct from 'send' or jsonb_typeof(p_input) is distinct from 'object'
  or jsonb_typeof(p_input->'body') is distinct from 'string' or jsonb_typeof(p_input->'clientId') is distinct from 'string'
  or char_length(p_input->>'body') not between 1 and 1000 or (p_input->>'body') ~ '^[[:space:]]*$'
  or (p_input->>'clientId') !~ '^[a-zA-Z0-9_-]{8,100}$' then raise exception using errcode='PT400',message='Invalid message'; end if;
 insert into public.direct_messages(conversation_id,sender_id,body,client_id) values(c.id,p_user_id,p_input->>'body',p_input->>'clientId')
  on conflict(sender_id,client_id) do nothing returning * into m;
 if not found then
  select * into m from public.direct_messages where sender_id=p_user_id and client_id=p_input->>'clientId';
  if m.conversation_id<>c.id or m.body<>p_input->>'body' then raise exception using errcode='PT409',message='Retry ID already used'; end if;
 end if;
 select jsonb_build_object('id',m.id,'conversationId',m.conversation_id,'senderId',m.sender_id,'senderName',p.display_name,
  'senderUsername',p.username,'senderAvatarUrl',p.avatar_url,'body',m.body,'createdAt',m.created_at) into result from public.profiles p where p.id=p_user_id;
 return jsonb_build_object('message',result,'recipientId',peer);
end $$;
revoke all on function public.direct_chat(text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.direct_chat(text,uuid,uuid,jsonb) to service_role;

alter table public.notifications add column direct_message_id uuid references public.direct_messages(id) on delete cascade;
create index notifications_direct_message on public.notifications(direct_message_id) where direct_message_id is not null;
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check(type in (
 'added_to_pick','pick_started','reminder','vote_needed','winner_decided','pick_canceled','plan_time_set','plan_reminder','did_you_go','group_invite','group_message','direct_message'));
alter table public.notifications add constraint notifications_direct_message_check check((type='direct_message')=(direct_message_id is not null));
create unique index notifications_once_per_direct_message on public.notifications(user_id,direct_message_id) where type='direct_message';
alter function public.notify_insert(uuid[],text,uuid,jsonb) rename to notify_insert_before_direct_messages;
alter function public.notify_insert_before_direct_messages(uuid[],text,uuid,jsonb) set schema private;
create function public.notify_insert(p_user_ids uuid[],p_type text,p_pick_id uuid,p_payload jsonb) returns setof uuid
language plpgsql set search_path='' as $$
declare m public.direct_messages; c public.direct_conversations; peer uuid;
begin
 if p_type<>'direct_message' then
  return query select * from private.notify_insert_before_direct_messages(p_user_ids,p_type,p_pick_id,p_payload);return;
 end if;
 select * into m from public.direct_messages where id=private.try_uuid(p_payload->>'messageId');
 if not found then return; end if;
 select * into c from public.direct_conversations where id=m.conversation_id;
 peer:=case when m.sender_id=c.user_low then c.user_high else c.user_low end;
 perform private.lock_direct_pair(m.sender_id,peer);
 return query insert into public.notifications(user_id,type,direct_message_id,payload)
  select peer,'direct_message',m.id,jsonb_build_object('conversationId',c.id,'messageId',m.id)
  where peer=any(p_user_ids) on conflict do nothing returning user_id;
end $$;
revoke all on function public.notify_insert(uuid[],text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.notify_insert(uuid[],text,uuid,jsonb) to service_role;
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table public.direct_messages;
 end if;
end $$;
