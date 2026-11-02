-- Complete M4 Hang using existing social graph, canonical Pick RPC and notification system.
alter table public.hang_posts add column pick_id uuid references public.picks(id) on delete set null;
alter table public.hang_posts add constraint hang_posts_group_fk
 foreign key(group_id) references public.groups(id) on delete cascade not valid;

create function private.can_view_hang(p_id uuid, p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.hang_posts h where h.id=p_id and h.expires_at>now()
  and (h.author_id=p_user or (not private.is_blocked_between(h.author_id,p_user) and
   ((h.audience='all_friends' and private.are_friends(h.author_id,p_user)) or
    (h.audience='group' and exists(select 1 from public.group_members m
     where m.group_id=h.group_id and m.user_id=p_user))))));
$$;
revoke all on function private.can_view_hang(uuid,uuid) from public,anon;
grant execute on function private.can_view_hang(uuid,uuid) to authenticated,service_role;
drop policy "hang: own active only until graph integration" on public.hang_posts;
create policy "hang: visible active posts" on public.hang_posts for select to authenticated
 using(private.can_view_hang(id,(select auth.uid())));
drop policy "hang responses: author active only until graph integration" on public.hang_responses;
create policy "hang responses: own or author, currently eligible" on public.hang_responses
 for select to authenticated using (
 private.can_view_hang(post_id,(select auth.uid())) and private.can_view_hang(post_id,user_id)
 and (user_id=(select auth.uid()) or exists(select 1 from public.hang_posts h
  where h.id=post_id and h.author_id=(select auth.uid()))));

create function public.hang_access(p_id uuid,p_user uuid) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('blocked',private.is_blocked_between(h.author_id,p_user),
 'acceptedFriends',private.are_friends(h.author_id,p_user),
 'groupMember',exists(select 1 from public.group_members m where m.group_id=h.group_id and m.user_id=p_user))
 from public.hang_posts h where h.id=p_id;
$$;
create function private.hang_json(p_id uuid,p_user uuid) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('id',h.id,'authorId',h.author_id,
 'authorName',(select display_name from public.profiles where id=h.author_id),'activity',h.activity,
 'startsAt',h.starts_at,'expiresAt',h.expires_at,'audience',h.audience,'groupId',h.group_id,
 'pickId',h.pick_id,'myStatus',(select status from public.hang_responses r where r.post_id=h.id and r.user_id=p_user),
 'downCount',(select count(*) from public.hang_responses r where r.post_id=h.id and r.status='down'
   and private.can_view_hang(h.id,r.user_id)))
 from public.hang_posts h where h.id=p_id and private.can_view_hang(h.id,p_user);
$$;
revoke all on function private.hang_json(uuid,uuid) from public,anon,authenticated;
grant execute on function private.hang_json(uuid,uuid) to service_role;
create function public.hang_list(p_user uuid) returns jsonb
language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(private.hang_json(id,p_user) order by starts_at,id),'[]'::jsonb)
 from (select id,starts_at from public.hang_posts where private.can_view_hang(id,p_user)
 order by starts_at,id limit 20) h;
$$;
create function public.hang_get(p_id uuid,p_user uuid) returns jsonb
language sql stable set search_path='' as $$ select private.hang_json(p_id,p_user); $$;
create function public.hang_create(p_user uuid,p_input jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare v_id uuid; v_group uuid := (p_input->>'groupId')::uuid;
begin
 if p_input->>'audience'='group' and not exists(select 1 from public.group_members
  where group_id=v_group and user_id=p_user) then
  raise exception using errcode='PT403',message='Join this group before posting'; end if;
 insert into public.hang_posts(author_id,starts_at,expires_at,activity,audience,group_id)
 values(p_user,(p_input->>'startsAt')::timestamptz,(p_input->>'expiresAt')::timestamptz,
  p_input->>'activity',p_input->>'audience',v_group) returning id into v_id;
 return private.hang_json(v_id,p_user);
end $$;
create function public.hang_respond(p_id uuid,p_user uuid,p_status text) returns void
language plpgsql set search_path='' as $$
begin
 perform 1 from public.hang_posts where id=p_id for update;
 if not found or not private.can_view_hang(p_id,p_user) then
  raise exception using errcode='PT404',message='Hang post not found'; end if;
 if p_status is null or p_status not in ('down','maybe','cant') then
  raise exception using errcode='PT400',message='Choose down, maybe or cant'; end if;
 insert into public.hang_responses(post_id,user_id,status) values(p_id,p_user,p_status)
 on conflict(post_id,user_id) do update set status=excluded.status;
end $$;
create function public.hang_create_pick(p_id uuid,p_user uuid,p_input jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare h public.hang_posts; v_users uuid[]; v_host uuid; v_pick uuid;
begin
 select * into h from public.hang_posts where id=p_id for update;
 if not found or not private.can_view_hang(p_id,p_user) then
  raise exception using errcode='PT404',message='Hang post not found'; end if;
 if h.author_id<>p_user then raise exception using errcode='PT403',message='Only the author can create this Pick'; end if;
 -- Reuse only while it is a draft and its membership still matches today's eligible downs.
 if h.audience='group' and not exists(select 1 from public.group_members where group_id=h.group_id and user_id=p_user) then
  raise exception using errcode='PT403',message='You are no longer in this group'; end if;
 select array_agg(user_id order by user_id) into v_users from public.hang_responses
 where post_id=p_id and status='down' and private.can_view_hang(p_id,user_id);
 if coalesce(cardinality(v_users),0)=0 then
  raise exception using errcode='PT409',message='Nobody eligible is down yet',hint='no_down'; end if;
 v_host := case when p_user=any(v_users) then p_user else v_users[1] end;
 -- Reuse the existing Pick safety rule when the author delegates hosting.
 select array_agg(u order by u) into v_users from unnest(v_users) u
 where u=v_host or not private.is_blocked_between(v_host,u);
 if cardinality(v_users)>private.pick_participant_cap() then raise exception using errcode='PT409',message='A Pick can have at most 30 people'; end if;
 if h.pick_id is not null then
  perform 1 from public.picks where id=h.pick_id for update;
  if exists(select 1 from public.picks where id=h.pick_id and state='draft') then
   if (select array_agg(user_id order by user_id) from public.pick_participants where pick_id=h.pick_id) is distinct from v_users then
    raise exception using errcode='PT409',message='Responses changed. Cancel the existing Pick before creating another'; end if;
   return jsonb_build_object('pickId',h.pick_id,'participantIds',to_jsonb(v_users),'created',false);
  end if;
  if exists(select 1 from public.picks where id=h.pick_id and state not in ('completed','canceled')) then
   raise exception using errcode='PT409',message='This hang already has a Pick in progress'; end if;
 end if;
 if not public.consume_user_limit('create',p_user) then
  raise exception using errcode='PT429',message='Request limit reached'; end if;
 -- Same creation path as POST /picks. Never copy Pick insertion/ranking/voting logic here.
 v_pick := (public.pick_create_options(v_host,p_input)->>'id')::uuid;
 update public.picks set plan_at=h.starts_at,group_id=h.group_id where id=v_pick;
 insert into public.pick_participants(pick_id,user_id)
 select v_pick,u from unnest(v_users) u where u<>v_host on conflict do nothing;
 -- Recheck eligibility after membership triggers; do not notify a skipped/removed user.
 if (select array_agg(user_id order by user_id) from public.pick_participants where pick_id=v_pick)
    is distinct from v_users or exists(select 1 from unnest(v_users) u
    where not private.can_view_hang(p_id,u) or (u<>v_host and private.is_blocked_between(v_host,u))) then
  raise exception using errcode='PT409',message='People changed while creating the Pick. Try again';
 end if;
 update public.hang_posts set pick_id=v_pick where id=p_id;
 return jsonb_build_object('pickId',v_pick,'participantIds',to_jsonb(v_users),'created',true);
end $$;
revoke all on function public.hang_access(uuid,uuid), public.hang_list(uuid),public.hang_get(uuid,uuid),
 public.hang_create(uuid,jsonb),public.hang_respond(uuid,uuid,text),public.hang_create_pick(uuid,uuid,jsonb)
 from public,anon,authenticated;
grant execute on function public.hang_access(uuid,uuid),public.hang_list(uuid),public.hang_get(uuid,uuid),
 public.hang_create(uuid,jsonb),public.hang_respond(uuid,uuid,text),public.hang_create_pick(uuid,uuid,jsonb)
 to service_role;
