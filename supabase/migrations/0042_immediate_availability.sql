-- PR 2 revision: availability gates individuals during swiping, not a waiting stage.
-- Additive because application to shared databases cannot be independently verified.
alter table public.pick_availability add column started_at timestamptz;

create function private.availability_eligible_ids(p_id uuid) returns uuid[]
language sql stable set search_path='' as $$
 select coalesce(array_agg(a.user_id order by a.user_id),'{}'::uuid[])
 from public.pick_availability a join public.picks p on p.id=a.pick_id
 where p.id=p_id and a.revision=p.availability_revision and a.response in ('yes','maybe')
  and private.availability_access(p.id,a.user_id)
$$;
revoke all on function private.availability_eligible_ids(uuid) from public,anon,authenticated;
grant execute on function private.availability_eligible_ids(uuid) to service_role;
create or replace function private.availability_voter(p_id uuid,p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.picks p where p.id=p_id and
  (p.proposed_at is null or (private.availability_access(p.id,p_user) and
   ((p.state='swiping' and p.availability_locked_at is null and exists(select 1 from public.pick_availability a where a.pick_id=p.id and a.user_id=p_user and a.revision=p.availability_revision and a.response in ('yes','maybe')))
    or (p.availability_locked_at is not null and exists(select 1 from public.pick_voting_cohort c where c.pick_id=p.id and c.user_id=p_user))))))
$$;

create or replace function public.pick_availability_load(p_pick_id text,p_user_id uuid) returns jsonb
language plpgsql stable set search_path='' as $$ declare p public.picks; ids uuid[]; begin
 select * into p from public.picks where id=private.try_uuid(p_pick_id);
 if not found or not exists(select 1 from public.pick_participants where pick_id=p.id and user_id=p_user_id) then raise exception using errcode='PT404',message='Pick not found'; end if;
 if p.proposed_at is null then return null; end if;
 if not private.availability_access(p.id,p_user_id) then raise exception using errcode='PT404',message='Pick not found'; end if;
 ids:=case when p.availability_locked_at is null then private.availability_eligible_ids(p.id) else array(select user_id from public.pick_voting_cohort where pick_id=p.id and private.availability_access(p.id,user_id) order by user_id) end;
 return jsonb_build_object('proposedAt',p.proposed_at,'groupName',(select name from public.groups where id=p.group_id),'revision',p.availability_revision,
  'locked',p.availability_locked_at is not null,'deadlineMinutes',p.swipe_deadline_minutes,
  'responseOpen',p.state='swiping' and p.availability_locked_at is null and (p.deadline_at is null or p.deadline_at>clock_timestamp()),
  'canVote',private.availability_voter(p.id,p_user_id),'eligibleUserIds',ids,
  'cohortUserIds',coalesce((select jsonb_agg(user_id order by user_id) from public.pick_voting_cohort where pick_id=p.id and private.availability_access(p.id,user_id)),'[]'::jsonb),
  'participants',coalesce((select jsonb_agg(jsonb_build_object('userId',pp.user_id,'displayName',coalesce(pr.display_name,'Someone'),'response',a.response,'started',a.started_at is not null) order by pp.joined_at,pp.user_id)
    from public.pick_participants pp join public.profiles pr on pr.id=pp.user_id left join public.pick_availability a on a.pick_id=p.id and a.user_id=pp.user_id and a.revision=p.availability_revision
    where pp.pick_id=p.id and private.availability_access(p.id,pp.user_id)),'[]'::jsonb));
end $$;

create or replace function public.pick_availability_respond(p_pick_id text,p_user_id uuid,p_revision integer,p_response text) returns void
language plpgsql set search_path='' as $$ declare p public.picks; began timestamptz; begin
 p:=private.lock_pick_as_participant(p_pick_id,p_user_id);
 if not private.availability_access(p.id,p_user_id) then raise exception using errcode='PT404',message='Pick not found'; end if;
 if p.proposed_at is null or p.state<>'swiping' or p.availability_locked_at is not null or (p.deadline_at is not null and p.deadline_at<=clock_timestamp()) then raise exception using errcode='PT409',message='The swipe round has closed; refresh this Pick'; end if;
 if p.availability_revision is distinct from p_revision then raise exception using errcode='PT409',message='Time changed; refresh this Pick'; end if;
 if p_response is null or p_response not in ('yes','maybe','cant') then raise exception using errcode='PT400',message='Invalid availability response'; end if;
 select started_at into began from public.pick_availability where pick_id=p.id and user_id=p_user_id;
 if began is not null and p_response='cant' then raise exception using errcode='PT409',message='Your voting response is kept after your first swipe. Update attendance after results.'; end if;
 -- The last Yes/Maybe cannot decline: an empty round could never close and would stay swiping.
 if p_response='cant' and private.availability_eligible_ids(p.id) <@ array[p_user_id] then raise exception using errcode='PT409',message='Someone has to be able to go. Cancel the Pick instead.'; end if;
 insert into public.pick_availability(pick_id,user_id,revision,response) values(p.id,p_user_id,p_revision,p_response)
 on conflict(pick_id,user_id) do update set response=excluded.response,revision=excluded.revision,updated_at=now();
 update public.picks set updated_at=now() where id=p.id;
end $$;
create or replace function public.pick_availability_time(p_pick_id text,p_user_id uuid,p_revision integer,p_proposed_at timestamptz) returns void
language plpgsql set search_path='' as $$ declare p public.picks; begin
 p:=private.lock_pick_as_participant(p_pick_id,p_user_id);
 if p.host_id is distinct from p_user_id then raise exception using errcode='PT403',message='Host only'; end if;
 raise exception using errcode='PT409',message='The proposed time is fixed for this decision. Revisit scheduling after results.';
end $$;

-- Claims now protect creation-time initialization only. No participant minimum or wait.
create or replace function public.pick_availability_claim(p_pick_id text,p_user_id uuid) returns jsonb
language plpgsql set search_path='' as $$ declare p public.picks; token uuid:=gen_random_uuid(); begin
 p:=private.lock_pick_as_participant(p_pick_id,p_user_id);
 if not private.availability_access(p.id,p_user_id) then raise exception using errcode='PT404',message='Pick not found'; end if;
 if p.host_id is distinct from p_user_id then raise exception using errcode='PT403',message='Host only'; end if;
 if p.proposed_at is null or p.state='canceled' then raise exception using errcode='PT409',message='Pick cannot initialize'; end if;
 if p.state<>'draft' then return jsonb_build_object('started',true,'candidateCount',(select count(*) from public.pick_candidates where pick_id=p.id)); end if;
 if exists(select 1 from private.pick_availability_starts where pick_id=p.id and expires_at>clock_timestamp()) then raise exception using errcode='PT409',message='Pick is initializing'; end if;
 if p.proposed_at<=now() or (p.swipe_deadline_minutes>0 and p.proposed_at<=now()+make_interval(mins=>p.swipe_deadline_minutes+30)) then raise exception using errcode='PT409',message='Choose a later outing time'; end if;
 insert into private.pick_availability_starts values(p.id,token,p.availability_revision,array[p_user_id],clock_timestamp()+interval '2 minutes')
 on conflict(pick_id) do update set token=excluded.token,revision=excluded.revision,cohort=excluded.cohort,expires_at=excluded.expires_at;
 return jsonb_build_object('started',false,'token',token);
end $$;
create or replace function public.pick_availability_finish(p_pick_id text,p_user_id uuid,p_token uuid,p_candidates jsonb) returns void
language plpgsql set search_path='' as $$ declare p public.picks; claim private.pick_availability_starts; begin
 p:=private.lock_pick_as_participant(p_pick_id,p_user_id);
 if p.host_id is distinct from p_user_id or not private.availability_access(p.id,p_user_id) then raise exception using errcode='PT403',message='Host only'; end if;
 select * into claim from private.pick_availability_starts where pick_id=p.id;
 if p.state<>'draft' or claim.token is distinct from p_token or claim.revision is distinct from p.availability_revision or claim.expires_at<=clock_timestamp() then raise exception using errcode='PT409',message='Initialization changed'; end if;
 if p.proposed_at<=now() or (p.swipe_deadline_minutes>0 and p.proposed_at<=now()+make_interval(mins=>p.swipe_deadline_minutes+30)) then raise exception using errcode='PT409',message='Choose a later outing time'; end if;
 -- Reuse the canonical candidate writer and Group Ideas/provenance checks.
 perform private.pick_start_before_availability(p_pick_id,p_user_id,p_candidates);
 update public.picks set plan_at=proposed_at,availability_locked_at=null,
  deadline_at=case when swipe_deadline_minutes=0 then null else clock_timestamp()+make_interval(mins=>swipe_deadline_minutes) end where id=p.id;
 delete from private.pick_availability_starts where pick_id=p.id;
end $$;

-- Same canonical writer; only ordinary Picks require two people before start.
create or replace function private.pick_start_before_ideas(p_pick_id text, p_user_id uuid, p_candidates jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid := private.try_uuid(p_pick_id);
  v_pick public.picks%rowtype;
  v_participants integer;
begin
  select * into v_pick from public.picks where id = v_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'Pick not found';
  end if;
  if v_pick.host_id <> p_user_id then
    raise exception using errcode = 'PT403', message = 'Only the host can start this Pick';
  end if;
  if v_pick.state <> 'draft' then
    raise exception using errcode = 'PT409', message = 'Pick must be draft to start';
  end if;
  select count(*) into v_participants from public.pick_participants where pick_id = v_id;
  if v_participants < 2 and v_pick.proposed_at is null then
    raise exception using errcode = 'PT409', message = 'A Pick needs at least 2 participants to start';
  end if;
  if jsonb_typeof(p_candidates) is distinct from 'array' or jsonb_array_length(p_candidates) = 0 then
    raise exception using errcode = 'PT400', message = 'At least one candidate is required to start';
  end if;

  -- Keys are the API's CandidateSnapshot shape ("placeId", camelCase), so the
  -- record column must be quoted: jsonb_to_recordset matches keys exactly.
  insert into public.places (id, name, category, lat, lng, raw)
  select c."placeId", coalesce(c.snapshot ->> 'name', c."placeId"), v_pick.category,
         (c.snapshot ->> 'lat')::double precision, (c.snapshot ->> 'lng')::double precision, c.snapshot
  from jsonb_to_recordset(p_candidates) as c("placeId" text, snapshot jsonb)
  on conflict (id) do update set
    name = excluded.name, lat = excluded.lat, lng = excluded.lng, raw = excluded.raw, updated_at = now();

  -- A draft may already hold a pool from an earlier refresh; replace it.
  delete from public.pick_candidates where pick_id = v_id;

  insert into public.pick_candidates (pick_id, place_id, snapshot)
  select v_id, c."placeId", c.snapshot
  from jsonb_to_recordset(p_candidates) as c("placeId" text, snapshot jsonb);

  update public.picks set state = 'swiping' where id = v_id;
exception
  when check_violation or not_null_violation or unique_violation or cardinality_violation
    or invalid_text_representation then
    raise exception using errcode = 'PT400', message = 'Invalid candidate data';
end;
$$;

create or replace function private.availability_ballot_guard() returns trigger
language plpgsql set search_path='' as $$ declare p public.picks; begin
 select * into p from public.picks where id=new.pick_id for update;
 if p.proposed_at is null then return new; end if;
 if not private.availability_voter(p.id,new.user_id) then raise exception using errcode='PT403',message='Confirm Yes or Maybe before participating'; end if;
 if tg_table_name='preferences' then
  if p.state<>'swiping' or (p.deadline_at is not null and p.deadline_at<=clock_timestamp()) then raise exception using errcode='PT409',message='The swipe round has closed'; end if;
  update public.pick_availability set started_at=coalesce(started_at,clock_timestamp()) where pick_id=p.id and user_id=new.user_id;
 elsif p.state<>'final_vote' or p.availability_locked_at is null then raise exception using errcode='PT409',message='Final voting is not open'; end if;
 return new;
end $$;
create or replace function private.availability_snapshot(p_id text,r jsonb) returns jsonb
language plpgsql stable set search_path='' as $$ declare ids jsonb; key text; p public.picks; begin
 select * into p from public.picks where id=private.try_uuid(p_id);
 if r is null or p.proposed_at is null then return r; end if;
 if p.availability_locked_at is null then ids:=to_jsonb(private.availability_eligible_ids(p.id));
 else select coalesce(jsonb_agg(user_id order by user_id),'[]'::jsonb) into ids from public.pick_voting_cohort where pick_id=p.id and private.availability_access(p.id,user_id); end if;
 r:=r||jsonb_build_object('participantIds',ids,'invitedCount',(select count(*) from public.pick_participants where pick_id=p.id and private.availability_access(p.id,user_id)),'awaitingResponses',(select count(*) from public.pick_participants pp where pp.pick_id=p.id and private.availability_access(p.id,pp.user_id) and not exists(select 1 from public.pick_availability a where a.pick_id=p.id and a.user_id=pp.user_id and a.revision=p.availability_revision)));
 foreach key in array array['preferences','ballots'] loop
  if r ? key then r:=jsonb_set(r,array[key],coalesce((select jsonb_agg(x) from jsonb_array_elements(r->key) x where ids ? (x->>'userId')),'[]'::jsonb)); end if;
 end loop;
 return r;
end $$;
create function private.availability_freeze(p_pick_id text,p_version text,p_actor text,p_user_id uuid) returns text
language plpgsql set search_path='' as $$ declare p public.picks; ids uuid[]; v text; begin
 select * into p from public.picks where id=private.try_uuid(p_pick_id) for update;
 if p.proposed_at is null then return p_version; end if;
 if p_actor not in ('host','system') or (p_actor='host' and (p.host_id is distinct from p_user_id or not private.availability_access(p.id,p_user_id))) then raise exception using errcode='PT403',message='Host only'; end if;
 if p.state<>'swiping' or p.version::text is distinct from p_version then raise exception using errcode='PT409',message='Pick changed; reload before trying again'; end if;
 if p_actor='system' and p.close_threshold=100 and (p.deadline_at is null or p.deadline_at>clock_timestamp())
  and ((select count(*) from public.pick_participants where pick_id=p.id and private.availability_access(p.id,user_id))<2 or exists(select 1 from public.pick_participants pp where pp.pick_id=p.id and private.availability_access(p.id,pp.user_id) and not exists(select 1 from public.pick_availability a where a.pick_id=p.id and a.user_id=pp.user_id and a.revision=p.availability_revision))) then raise exception using errcode='PT409',message='Invitations are still unanswered'; end if;
 ids:=private.availability_eligible_ids(p.id);
 if cardinality(ids)=0 then raise exception using errcode='PT409',message='No eligible respondents; wait for a response or cancel'; end if;
 delete from public.pick_voting_cohort where pick_id=p.id;
 insert into public.pick_voting_cohort(pick_id,user_id,revision) select p.id,unnest(ids),p.availability_revision;
 update public.picks set availability_locked_at=clock_timestamp() where id=p.id returning version::text into v;
 return v;
end $$;
alter function public.pick_close_apply(text,text,uuid,text,jsonb) rename to pick_close_before_immediate;
alter function public.pick_close_before_immediate(text,text,uuid,text,jsonb) set schema private;
create function public.pick_close_apply(p_pick_id text,p_actor text,p_actor_user_id uuid,p_version text,p_ranking jsonb) returns void
language plpgsql set search_path='' as $$ declare v text; begin
 v:=private.availability_freeze(p_pick_id,p_version,p_actor,p_actor_user_id);
 perform private.pick_close_before_immediate(p_pick_id,p_actor,p_actor_user_id,v,p_ranking);
end $$;
alter function public.heartbeat_save_ranking(text,uuid,text,jsonb) rename to heartbeat_rank_before_immediate;
alter function public.heartbeat_rank_before_immediate(text,uuid,text,jsonb) set schema private;
create function public.heartbeat_save_ranking(p_pick_id text,p_user_id uuid,p_version text,p_ranking jsonb) returns void
language plpgsql set search_path='' as $$ declare v text; begin
 v:=private.availability_freeze(p_pick_id,p_version,'host',p_user_id);
 perform private.heartbeat_rank_before_immediate(p_pick_id,p_user_id,v,p_ranking);
end $$;
-- Active proposed time is fixed; reuse post-result host scheduling and reconfirm RSVPs.
create or replace function public.pick_set_plan_time(p_pick_id text,p_user_id uuid,p_plan_at timestamptz) returns uuid[]
language plpgsql set search_path='' as $$ declare p public.picks; recipients uuid[]; begin
 p:=private.lock_pick_as_participant(p_pick_id,p_user_id);
 recipients:=private.pick_plan_time_before_availability(p_pick_id,p_user_id,p_plan_at);
 if p.proposed_at is not null and p.plan_at is distinct from p_plan_at then
  delete from public.pick_rsvps where pick_id=p.id;
 end if;
 return recipients;
end $$;
revoke all on function private.availability_freeze(text,text,text,uuid) from public,anon,authenticated;
grant execute on function private.availability_freeze(text,text,text,uuid) to service_role;
revoke all on function public.pick_close_apply(text,text,uuid,text,jsonb),public.heartbeat_save_ranking(text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.pick_close_apply(text,text,uuid,text,jsonb),public.heartbeat_save_ranking(text,uuid,text,jsonb) to service_role;

update public.pick_availability a set started_at=(select min(pr.updated_at) from public.preferences pr where pr.pick_id=a.pick_id and pr.user_id=a.user_id)
 where exists(select 1 from public.preferences pr where pr.pick_id=a.pick_id and pr.user_id=a.user_id);
delete from public.pick_voting_cohort c using public.picks p where c.pick_id=p.id and p.proposed_at is not null and p.state='swiping';
update public.picks set availability_locked_at=null where proposed_at is not null and state='swiping';
