-- A private projection of existing Pick/outcome records, not a new post/attendance model.
create index pick_outcomes_attended_user on public.pick_outcomes(user_id,pick_id) where went;
create function public.profile_past_moves(p_viewer_id uuid,p_target_id uuid,p_group_id uuid default null)
returns jsonb language plpgsql stable set search_path='' as $$
declare target public.profiles; own boolean:=p_viewer_id=p_target_id; result jsonb;
begin
 select * into target from public.profiles where id=p_target_id;
 if not found or p_viewer_id is null or (not own and (not private.are_friends(p_viewer_id,p_target_id) or private.is_blocked_between(p_viewer_id,p_target_id))) then
  raise exception using errcode='PT404',message='Profile not found';
 end if;
 if not own and not target.share_profile_metadata then return '{"visible":false,"pastMoves":[]}'::jsonb; end if;
 if p_group_id is not null and not exists(select 1 from public.group_members where group_id=p_group_id and user_id=p_viewer_id) then
  raise exception using errcode='PT404',message='Group not found';
 end if;
 select coalesce(jsonb_agg(x.value order by x.occurred_at desc,x.id),'[]') into result from (
  select p.id,coalesce(p.plan_at,p.decided_at) occurred_at,jsonb_build_object(
   'pickId',p.id,'category',p.category,'occurredAt',coalesce(p.plan_at,p.decided_at),'confirmedAt',case when own then o.answered_at end,
   'winner',jsonb_build_object('placeId',c.place_id,
    'name',case when c.source='google' or c.snapshot->>'provider'='google' or c.snapshot->>'retention'='request' then null else c.snapshot->>'name' end,
    'locationText',case when c.source='google' or c.snapshot->>'provider'='google' or c.snapshot->>'retention'='request' then null else c.snapshot->>'address' end,
    'origin',case when c.snapshot->>'origin'='group_idea' then 'group_idea' when c.source='custom' or c.snapshot->>'provider'='custom' then 'custom' else 'place' end),
   'group',case when g.id is not null and exists(select 1 from public.group_members gm where gm.group_id=g.id and gm.user_id=p_viewer_id)
     then jsonb_build_object('id',g.id,'name',g.name) else null end,
   'participantCount',case when own then (select count(*) from public.pick_participants pp where pp.pick_id=p.id) end,
   'attendedCount',case when own then (select count(*) from public.pick_outcomes att where att.pick_id=p.id and att.went) end
  ) value
  from public.picks p
  join public.pick_participants subject on subject.pick_id=p.id and subject.user_id=p_target_id
  join public.pick_outcomes o on o.pick_id=p.id and o.user_id=p_target_id and o.went
  join public.pick_candidates c on c.pick_id=p.id and c.place_id=p.winner_place_id
  left join public.groups g on g.id=p.group_id
  where p.state='completed' and p.decided_at is not null
   and coalesce(p.plan_at+interval '1 hour',p.decided_at+interval '3 hours')<=now()
   and (p_group_id is null or p.group_id=p_group_id)
   -- Sharing never grants a friend access to an unfamiliar/private plan.
   and (own or exists(select 1 from public.pick_participants viewer where viewer.pick_id=p.id and viewer.user_id=p_viewer_id))
  order by coalesce(p.plan_at,p.decided_at) desc,p.id limit 50
 ) x;
 return jsonb_build_object('visible',true,'pastMoves',result);
end $$;
revoke all on function public.profile_past_moves(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.profile_past_moves(uuid,uuid,uuid) to service_role;
