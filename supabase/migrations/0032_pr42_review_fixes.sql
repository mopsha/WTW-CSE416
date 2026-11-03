-- Forward-only corrections for PR #42. Historical migrations remain unchanged.
-- Removal is not a ban: explicit bearer-link joins keep their existing contract.
create or replace function public.group_remove_member(p_user_id uuid,p_group_id uuid,p_member_id uuid)
returns void language plpgsql set search_path='' as $$ begin
 perform private.lock_group_as_owner(p_group_id,p_user_id);
 if p_member_id=p_user_id then
  raise exception using errcode='PT409',message='The owner cannot be removed; delete the group instead',hint='owner_cannot_leave';
 end if;
 update public.group_invitations set status='declined',resolved_at=now()
  where group_id=p_group_id and invitee_id=p_member_id and status='pending';
 update public.notifications set read_at=coalesce(read_at,now())
  where user_id=p_member_id and type='group_invite' and payload->>'inviteId' in
   (select id::text from public.group_invitations where group_id=p_group_id and invitee_id=p_member_id and status='declined');
 delete from public.group_members where group_id=p_group_id and user_id=p_member_id;
end $$;

-- A single statement joins authorization to each read's snapshot. No tuple locks on
-- polling. Concurrent removal can finish before or after that snapshot, just like RLS.
-- Write paths below still use the original locking helpers and commit-time checks.
create or replace function public.group_chat(p_action text,p_user_id uuid,p_group_id uuid,p_input jsonb default '{}')
returns jsonb language plpgsql set search_path='' as $$
declare m public.group_messages; result jsonb; recipients jsonb;
begin
 if p_action='list' then
  select history.value into result from public.groups g
   join public.group_members member on member.group_id=g.id and member.user_id=p_user_id
   cross join lateral (
    select coalesce(jsonb_agg(x.value order by x.created_at,x.id),'[]'::jsonb) value from (
     select msg.created_at,msg.id,jsonb_build_object('id',msg.id,'groupId',msg.group_id,'senderId',msg.sender_id,
      'senderName',p.display_name,'senderUsername',p.username,'senderAvatarUrl',p.avatar_url,
      'body',msg.body,'createdAt',msg.created_at) value
     from public.group_messages msg join public.profiles p on p.id=msg.sender_id
     where msg.group_id=g.id and not private.is_blocked_between(p_user_id,msg.sender_id)
     order by msg.created_at desc,msg.id desc limit 50
    ) x
   ) history where g.id=p_group_id;
  if not found then raise exception using errcode='PT404',message='Group not found',hint='group_not_found'; end if;
  return result;
 end if;
 perform private.lock_group_as_member(p_group_id,p_user_id);
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

create or replace function public.direct_chat(p_action text,p_user_id uuid,p_target_id uuid,p_input jsonb default '{}') returns jsonb
language plpgsql set search_path='' as $$
declare c public.direct_conversations; m public.direct_messages; peer uuid; conversation jsonb; result jsonb;
begin
 if p_action='list' then
  select jsonb_build_object('conversation',jsonb_build_object('id',dc.id,'createdAt',dc.created_at,
    'peer',jsonb_build_object('id',p.id,'displayName',p.display_name,'username',p.username,'avatarUrl',p.avatar_url)),
    'messages',history.value) into result
  from public.direct_conversations dc
  join public.profiles p on p.id=case when p_user_id=dc.user_low then dc.user_high else dc.user_low end
  cross join lateral (
   select coalesce(jsonb_agg(x.value order by x.created_at,x.id),'[]'::jsonb) value from (
    select msg.id,msg.created_at,jsonb_build_object('id',msg.id,'conversationId',msg.conversation_id,'senderId',msg.sender_id,
     'senderName',sender.display_name,'senderUsername',sender.username,'senderAvatarUrl',sender.avatar_url,
     'body',msg.body,'createdAt',msg.created_at) value
    from public.direct_messages msg join public.profiles sender on sender.id=msg.sender_id
    where msg.conversation_id=dc.id order by msg.created_at desc,msg.id desc limit 50
   ) x
  ) history
  where dc.id=p_target_id and p_user_id in (dc.user_low,dc.user_high)
   and private.are_friends(dc.user_low,dc.user_high) and not private.is_blocked_between(dc.user_low,dc.user_high);
  if not found then raise exception using errcode='PT404',message='Conversation unavailable'; end if;
  return result;
 end if;
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

create or replace function public.group_ideas(
  p_action text, p_user_id uuid, p_group_id uuid,
  p_idea_id uuid default null, p_input jsonb default '{}'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  g public.groups;
  i public.group_ideas;
  result jsonb;
begin
  if p_action in ('list','get') then
    select case when p_action='list' then
      (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id),'[]'::jsonb)
       from public.group_ideas x where x.group_id=grp.id)
     else (select to_jsonb(x) from public.group_ideas x where x.group_id=grp.id and x.id=p_idea_id)
     end into result
    from public.groups grp join public.group_members member
     on member.group_id=grp.id and member.user_id=p_user_id where grp.id=p_group_id;
    if not found then raise exception using errcode='PT404',message='Group not found',hint='group_not_found'; end if;
    if result is null then raise exception using errcode='PT404',message='Idea not found'; end if;
    return result;
  end if;
  g := private.lock_group_as_member(p_group_id, p_user_id);
  if p_action not in ('get', 'create', 'update', 'delete') or p_action is null then
    raise exception using errcode = 'PT400', message = 'Invalid action';
  end if;
  if p_action <> 'create' then
    select * into i from public.group_ideas where id = p_idea_id and group_id = p_group_id for update;
    if not found then raise exception using errcode = 'PT404', message = 'Idea not found'; end if;
    if p_action = 'get' then return to_jsonb(i); end if;
    if i.created_by <> p_user_id and (p_action <> 'delete' or g.owner_id <> p_user_id) then
      raise exception using errcode = 'PT403', message = 'Not allowed';
    end if;
    if p_action = 'delete' then
      delete from public.group_ideas where id = i.id;
      return '{"status":"ok"}'::jsonb;
    end if;
  end if;
  if jsonb_typeof(p_input) is distinct from 'object'
    or jsonb_typeof(p_input->'name') is distinct from 'string'
    or jsonb_typeof(p_input->'category') is distinct from 'string'
    or (p_input ? 'description' and jsonb_typeof(p_input->'description') not in ('string', 'null'))
    or (p_input ? 'locationText' and jsonb_typeof(p_input->'locationText') not in ('string', 'null')) then
    raise exception using errcode = 'PT400', message = 'Invalid idea';
  end if;
  if p_action = 'create' then
    insert into public.group_ideas(group_id, created_by, name, category, description, location_text)
    values (p_group_id, p_user_id, btrim(p_input->>'name'), p_input->>'category',
      nullif(btrim(p_input->>'description'), ''), nullif(btrim(p_input->>'locationText'), '')) returning * into i;
  else
    update public.group_ideas set name = btrim(p_input->>'name'), category = p_input->>'category',
      description = nullif(btrim(p_input->>'description'), ''),
      location_text = nullif(btrim(p_input->>'locationText'), ''), updated_at = clock_timestamp()
      where id = i.id returning * into i;
  end if;
  return to_jsonb(i);
end;
$$;

-- Same server-only event table/advisory-lock pattern as private.rate_take.
-- Both transports share a sender budget: 10/10s, 60/min, 500/hour. The trigger
-- runs after RPC authorization and before insert, in the same transaction. Failed
-- inserts roll back quota. A retry of an existing client ID consumes no quota;
-- existing RPCs still reject changed content/destination with PT409.
alter table public.rate_limit_events drop constraint rate_limit_events_action_check;
alter table public.rate_limit_events add constraint rate_limit_events_action_check
 check(action in ('friend_request','report','invite_create','message_send'));
create function private.message_send_limit() returns trigger
language plpgsql set search_path='' as $$
declare stamp timestamptz:=clock_timestamp(); burst bigint; minute_count bigint; hour_count bigint;
begin
 perform pg_advisory_xact_lock(hashtextextended('wtw-rate:message_send:'||new.sender_id,0));
 if tg_table_name='group_messages' then
  if exists(select 1 from public.group_messages where sender_id=new.sender_id and client_id=new.client_id) then return new; end if;
 else
  if exists(select 1 from public.direct_messages where sender_id=new.sender_id and client_id=new.client_id) then return new; end if;
 end if;
 -- Take the timestamp after waiting for any concurrent sender transaction.
 stamp:=clock_timestamp();
 select count(*) filter(where created_at>stamp-interval '10 seconds'),
  count(*) filter(where created_at>stamp-interval '1 minute'),count(*)
 into burst,minute_count,hour_count from public.rate_limit_events
 where user_id=new.sender_id and action='message_send' and created_at>stamp-interval '1 hour';
 if burst>=10 or minute_count>=60 or hour_count>=500 then
  raise exception using errcode='PT429',message='Too many messages. Try again shortly.';
 end if;
 insert into public.rate_limit_events(user_id,action,created_at) values(new.sender_id,'message_send',stamp);
 return new;
end $$;
revoke all on function private.message_send_limit() from public,anon,authenticated;
create trigger message_send_limit before insert on public.group_messages
 for each row execute function private.message_send_limit();
create trigger message_send_limit before insert on public.direct_messages
 for each row execute function private.message_send_limit();

-- CREATE OR REPLACE retains existing grants; explicitly keep new/updated RPCs server-only.
revoke all on function public.group_remove_member(uuid,uuid,uuid),
 public.group_chat(text,uuid,uuid,jsonb),public.direct_chat(text,uuid,uuid,jsonb),
 public.group_ideas(text,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.group_remove_member(uuid,uuid,uuid),
 public.group_chat(text,uuid,uuid,jsonb),public.direct_chat(text,uuid,uuid,jsonb),
 public.group_ideas(text,uuid,uuid,uuid,jsonb) to service_role;
