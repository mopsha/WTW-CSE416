-- Availability collection remains draft: old clients never mistake it for swiping.
-- New RPCs follow the existing service_role-only, invoker, empty-search_path convention.
alter table public.picks
 add column proposed_at timestamptz,
 add column availability_revision integer not null default 0,
 add column availability_locked_at timestamptz,
 add column swipe_deadline_minutes integer,
 add constraint picks_availability_config check (
  (proposed_at is null and availability_revision=0 and availability_locked_at is null and swipe_deadline_minutes is null)
  or (proposed_at is not null and availability_revision>0 and swipe_deadline_minutes in (0,30,60,180,1440)
   and (state<>'draft' or deadline_at is null)));
create table public.pick_availability (
 pick_id uuid not null, user_id uuid not null, revision integer not null check(revision>0),
 response text not null check(response in ('yes','maybe','cant')), updated_at timestamptz not null default now(),
 primary key(pick_id,user_id),
 foreign key(pick_id,user_id) references public.pick_participants(pick_id,user_id) on delete cascade);
create table public.pick_voting_cohort (
 pick_id uuid not null, user_id uuid not null, revision integer not null check(revision>0),
 primary key(pick_id,user_id),
 foreign key(pick_id,user_id) references public.pick_participants(pick_id,user_id) on delete cascade);
create table private.pick_availability_starts (
 pick_id uuid primary key references public.picks(id) on delete cascade,
 token uuid not null, revision integer not null, cohort uuid[] not null, expires_at timestamptz not null);
create index picks_availability_pending on public.picks(proposed_at) where proposed_at is not null and state='draft';
alter table public.pick_availability enable row level security;
alter table public.pick_voting_cohort enable row level security;
revoke all on public.pick_availability,public.pick_voting_cohort from public,anon,authenticated;
grant select on public.pick_availability,public.pick_voting_cohort to authenticated;
grant all on public.pick_availability,public.pick_voting_cohort,private.pick_availability_starts to service_role;

-- Membership, group revocation and host blocking take precedence over a locked cohort.
create function private.availability_access(p_id uuid,p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.picks p join public.pick_participants pp on pp.pick_id=p.id
  where p.id=p_id and pp.user_id=p_user
   and (p.state in ('completed','canceled') or p.group_id is null or exists(select 1 from public.group_members gm where gm.group_id=p.group_id and gm.user_id=p_user))
   and (p.host_id is null or p.host_id=p_user or not private.is_blocked_between(p.host_id,p_user)))
$$;
revoke all on function private.availability_access(uuid,uuid) from public,anon;
grant execute on function private.availability_access(uuid,uuid) to authenticated,service_role;
create policy "availability: accessible Pick invitees" on public.pick_availability for select to authenticated
 using(private.availability_access(pick_id,(select auth.uid())));
create policy "cohort: accessible Pick invitees" on public.pick_voting_cohort for select to authenticated
 using(private.availability_access(pick_id,(select auth.uid())));
create function private.availability_voter(p_id uuid,p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.picks p where p.id=p_id and
  (p.proposed_at is null or (p.availability_locked_at is not null and private.availability_access(p.id,p_user)
   and exists(select 1 from public.pick_voting_cohort c where c.pick_id=p.id and c.user_id=p_user))))
$$;
revoke all on function private.availability_voter(uuid,uuid) from public,anon;
grant execute on function private.availability_voter(uuid,uuid) to authenticated,service_role;

create function public.pick_availability_load(p_pick_id text,p_user_id uuid) returns jsonb
language plpgsql stable set search_path='' as $$
declare p public.picks;
begin
 select * into p from public.picks where id=private.try_uuid(p_pick_id);
 if not found then raise exception using errcode='PT404',message='Pick not found'; end if;
 if not exists(select 1 from public.pick_participants where pick_id=p.id and user_id=p_user_id) then raise exception using errcode='PT404',message='Pick not found'; end if;
 if p.proposed_at is null then return null; end if;
 if not private.availability_access(p.id,p_user_id) then raise exception using errcode='PT404',message='Pick not found'; end if;
 return jsonb_build_object('proposedAt',p.proposed_at,'revision',p.availability_revision,
  'locked',p.availability_locked_at is not null,'deadlineMinutes',p.swipe_deadline_minutes,
  'canVote',private.availability_voter(p.id,p_user_id),
  'cohortUserIds',coalesce((select jsonb_agg(user_id order by user_id) from public.pick_voting_cohort where pick_id=p.id and private.availability_access(p.id,user_id)),'[]'::jsonb),
  'participants',coalesce((select jsonb_agg(jsonb_build_object('userId',pp.user_id,'displayName',coalesce(pr.display_name,'Someone'),'response',a.response) order by pp.joined_at,pp.user_id)
   from public.pick_participants pp join public.profiles pr on pr.id=pp.user_id
   left join public.pick_availability a on a.pick_id=p.id and a.user_id=pp.user_id and a.revision=p.availability_revision
   where pp.pick_id=p.id and private.availability_access(p.id,pp.user_id)),'[]'::jsonb));
end $$;

alter function public.pick_create_options(uuid,jsonb) rename to pick_create_before_availability;
alter function public.pick_create_before_availability(uuid,jsonb) set schema private;
create function public.pick_create_options(p_host_id uuid,p_input jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare r jsonb; at_time timestamptz; mins integer;
begin
 if p_input->>'proposedAt' is null then return private.pick_create_before_availability(p_host_id,p_input); end if;
 at_time:=(p_input->>'proposedAt')::timestamptz; mins:=(p_input->>'swipeDeadlineMinutes')::integer;
 if not isfinite(at_time) or at_time<=now() or at_time>now()+interval '30 days'
  or mins is null or mins not in (0,30,60,180,1440) or (p_input->>'deadlineAt') is not null
  or (mins>0 and at_time<=now()+make_interval(mins=>mins+30)) then
  raise exception using errcode='PT400',message='Invalid outing time or deferred deadline';
 end if;
 r:=private.pick_create_before_availability(p_host_id,p_input||jsonb_build_object('deadlineAt',null));
 update public.picks set proposed_at=at_time,availability_revision=1,swipe_deadline_minutes=mins where id=(r->>'id')::uuid;
 insert into public.pick_availability(pick_id,user_id,revision,response) values((r->>'id')::uuid,p_host_id,1,'yes');
 return r;
end $$;

alter function public.pick_load_options(text,uuid) rename to pick_load_before_availability;
alter function public.pick_load_before_availability(text,uuid) set schema private;
create function public.pick_load_options(p_pick_id text,p_user_id uuid) returns jsonb
language plpgsql stable set search_path='' as $$ declare r jsonb; a jsonb; begin
 r:=private.pick_load_before_availability(p_pick_id,p_user_id);
 if r is null then return null; end if;
 a:=public.pick_availability_load(p_pick_id,p_user_id);
 if a is null then return r; end if;
 return r||jsonb_build_object('availability',a);
end $$;

-- Every response, time edit and start claim takes the SAME Pick row lock.
create function private.availability_edit(p_pick_id text,p_user_id uuid,p_revision integer) returns public.picks
language plpgsql set search_path='' as $$ declare p public.picks; begin
 p:=private.lock_pick_as_participant(p_pick_id,p_user_id);
 if not private.availability_access(p.id,p_user_id) then raise exception using errcode='PT404',message='Pick not found'; end if;
 if p.proposed_at is null or p.state<>'draft' or p.availability_locked_at is not null then raise exception using errcode='PT409',message='Availability is closed'; end if;
 if p.availability_revision is distinct from p_revision then raise exception using errcode='PT409',message='Time changed; reconfirm the current time'; end if;
 if exists(select 1 from private.pick_availability_starts where pick_id=p.id and expires_at>clock_timestamp()) then raise exception using errcode='PT409',message='Swiping is starting; reload shortly'; end if;
 return p;
end $$;
create function public.pick_availability_respond(p_pick_id text,p_user_id uuid,p_revision integer,p_response text) returns void
language plpgsql set search_path='' as $$ declare p public.picks; begin
 p:=private.availability_edit(p_pick_id,p_user_id,p_revision);
 if p.proposed_at<=now() then raise exception using errcode='PT409',message='Ask the host to update the outing time'; end if;
 if p_response is null or p_response not in ('yes','maybe','cant') then raise exception using errcode='PT400',message='Invalid availability response'; end if;
 insert into public.pick_availability(pick_id,user_id,revision,response) values(p.id,p_user_id,p_revision,p_response)
 on conflict(pick_id,user_id) do update set revision=excluded.revision,response=excluded.response,updated_at=now();
 update public.picks set updated_at=now() where id=p.id; -- publishes a change through existing Realtime
end $$;
create function public.pick_availability_time(p_pick_id text,p_user_id uuid,p_revision integer,p_proposed_at timestamptz) returns void
language plpgsql set search_path='' as $$ declare p public.picks; begin
 p:=private.availability_edit(p_pick_id,p_user_id,p_revision);
 if p.host_id is distinct from p_user_id then raise exception using errcode='PT403',message='Host only'; end if;
 if p_proposed_at is null or not isfinite(p_proposed_at) or p_proposed_at<=now() or p_proposed_at>now()+interval '30 days'
  or (p.swipe_deadline_minutes>0 and p_proposed_at<=now()+make_interval(mins=>p.swipe_deadline_minutes+30)) then raise exception using errcode='PT400',message='Leave time for swiping and the final vote before the outing'; end if;
 if p_proposed_at=p.proposed_at then return; end if; -- retry does not invalidate twice
 update public.picks set proposed_at=p_proposed_at,availability_revision=availability_revision+1 where id=p.id;
 delete from public.pick_availability where pick_id=p.id;
 insert into public.pick_availability(pick_id,user_id,revision,response) values(p.id,p_user_id,p.availability_revision+1,'yes');
end $$;

create function public.pick_availability_claim(p_pick_id text,p_user_id uuid) returns jsonb
language plpgsql set search_path='' as $$ declare p public.picks; ids uuid[]; token uuid:=gen_random_uuid(); begin
 p:=private.lock_pick_as_participant(p_pick_id,p_user_id);
 if not private.availability_access(p.id,p_user_id) then raise exception using errcode='PT404',message='Pick not found'; end if;
 if p.host_id is distinct from p_user_id then raise exception using errcode='PT403',message='Host only'; end if;
 if p.proposed_at is null then raise exception using errcode='PT409',message='Not an availability Pick'; end if;
 if p.availability_locked_at is not null and p.state not in ('draft','canceled') then return jsonb_build_object('started',true,'candidateCount',(select count(*) from public.pick_candidates where pick_id=p.id)); end if;
 p:=private.availability_edit(p_pick_id,p_user_id,p.availability_revision);
 if p.proposed_at<=now() or (p.swipe_deadline_minutes>0 and p.proposed_at<=now()+make_interval(mins=>p.swipe_deadline_minutes+30)) then raise exception using errcode='PT409',message='Update the outing time before starting; leave time for swiping and the final vote'; end if;
 select array_agg(a.user_id order by a.user_id) into ids from public.pick_availability a where a.pick_id=p.id and a.revision=p.availability_revision and a.response in ('yes','maybe') and private.availability_access(p.id,a.user_id);
 if coalesce(cardinality(ids),0)<2 then raise exception using errcode='PT409',message='At least two Yes or Maybe responses are required'; end if;
 insert into private.pick_availability_starts values(p.id,token,p.availability_revision,ids,clock_timestamp()+interval '2 minutes') on conflict(pick_id) do update set token=excluded.token,revision=excluded.revision,cohort=excluded.cohort,expires_at=excluded.expires_at;
 return jsonb_build_object('started',false,'token',token);
end $$;

alter function public.pick_start(text,uuid,jsonb) rename to pick_start_before_availability;
alter function public.pick_start_before_availability(text,uuid,jsonb) set schema private;
create function public.pick_start(p_pick_id text,p_user_id uuid,p_candidates jsonb) returns void
language plpgsql set search_path='' as $$ declare p public.picks; begin
 select * into p from public.picks where id=private.try_uuid(p_pick_id) for update;
 if p.proposed_at is not null then raise exception using errcode='PT409',message='Update WTW to start availability Picks'; end if;
 perform private.pick_start_before_availability(p_pick_id,p_user_id,p_candidates);
end $$;
create function public.pick_availability_finish(p_pick_id text,p_user_id uuid,p_token uuid,p_candidates jsonb) returns void
language plpgsql set search_path='' as $$ declare p public.picks; claim private.pick_availability_starts; current_ids uuid[]; begin
 p:=private.lock_pick_as_participant(p_pick_id,p_user_id);
 if p.host_id is distinct from p_user_id or not private.availability_access(p.id,p_user_id) then raise exception using errcode='PT403',message='Host only'; end if;
 select * into claim from private.pick_availability_starts where pick_id=p.id;
 if p.state<>'draft' or claim.token is distinct from p_token or claim.revision is distinct from p.availability_revision or claim.expires_at<=clock_timestamp() then raise exception using errcode='PT409',message='Start changed; reload before retrying'; end if;
 if p.proposed_at<=now() or (p.swipe_deadline_minutes>0 and p.proposed_at<=now()+make_interval(mins=>p.swipe_deadline_minutes+30)) then raise exception using errcode='PT409',message='Outing time needs updating'; end if;
 select array_agg(a.user_id order by a.user_id) into current_ids from public.pick_availability a where a.pick_id=p.id and a.revision=p.availability_revision and a.response in ('yes','maybe') and private.availability_access(p.id,a.user_id);
 if current_ids is distinct from claim.cohort then raise exception using errcode='PT409',message='Participants changed; start again'; end if;
 insert into public.pick_voting_cohort(pick_id,user_id,revision) select p.id,unnest(claim.cohort),p.availability_revision;
 perform private.pick_start_before_availability(p_pick_id,p_user_id,p_candidates);
 update public.picks set availability_locked_at=now(),plan_at=proposed_at,
  deadline_at=case when swipe_deadline_minutes=0 then null else now()+make_interval(mins=>swipe_deadline_minutes) end where id=p.id;
 delete from private.pick_availability_starts where pick_id=p.id;
end $$;
create function public.pick_availability_abort(p_pick_id text,p_user_id uuid,p_token uuid) returns void
language plpgsql set search_path='' as $$ declare p public.picks; begin
 p:=private.lock_pick_as_participant(p_pick_id,p_user_id);
 if p.host_id is distinct from p_user_id then raise exception using errcode='PT403',message='Host only'; end if;
 delete from private.pick_availability_starts where pick_id=p.id and token=p_token;
end $$;

-- Database enforcement also protects direct service RPCs, independently of the UI.
create function private.availability_ballot_guard() returns trigger
language plpgsql set search_path='' as $$ declare p public.picks; begin
 select * into p from public.picks where id=new.pick_id for update;
 if p.proposed_at is not null and not private.availability_voter(p.id,new.user_id) then raise exception using errcode='PT403',message='Not in the locked voting cohort'; end if;
 return new;
end $$;
create trigger availability_swipe_guard before insert or update on public.preferences for each row execute function private.availability_ballot_guard();
create trigger availability_vote_guard before insert or update on public.final_votes for each row execute function private.availability_ballot_guard();

-- Filter every ranking/completion snapshot while retaining the invitation roster.
create function private.availability_snapshot(p_id text,r jsonb) returns jsonb
language plpgsql stable set search_path='' as $$ declare ids jsonb; key text; begin
 if r is null or not exists(select 1 from public.picks where id=private.try_uuid(p_id) and proposed_at is not null) then return r; end if;
 select coalesce(jsonb_agg(user_id order by user_id),'[]'::jsonb) into ids from public.pick_voting_cohort where pick_id=private.try_uuid(p_id) and private.availability_access(pick_id,user_id);
 r:=r||jsonb_build_object('participantIds',ids);
 foreach key in array array['preferences','ballots'] loop
  if r ? key then r:=jsonb_set(r,array[key],coalesce((select jsonb_agg(x) from jsonb_array_elements(r->key) x where ids ? (x->>'userId')),'[]'::jsonb)); end if;
 end loop;
 return r;
end $$;

alter function public.pick_load_for_close(text) rename to pick_load_for_close_before_availability;
alter function public.pick_load_for_close_before_availability(text) set schema private;
create function public.pick_load_for_close(p_pick_id text) returns jsonb
language sql stable set search_path='' as $$ select private.availability_snapshot(p_pick_id,private.pick_load_for_close_before_availability(p_pick_id)) $$;
revoke all on function public.pick_load_for_close(text) from public,anon,authenticated;
grant execute on function public.pick_load_for_close(text) to service_role;

alter function public.pick_load_for_vote(text) rename to pick_load_for_vote_before_availability;
alter function public.pick_load_for_vote_before_availability(text) set schema private;
create function public.pick_load_for_vote(p_pick_id text) returns jsonb
language sql stable set search_path='' as $$ select private.availability_snapshot(p_pick_id,private.pick_load_for_vote_before_availability(p_pick_id)) $$;
revoke all on function public.pick_load_for_vote(text) from public,anon,authenticated;
grant execute on function public.pick_load_for_vote(text) to service_role;

alter function public.heartbeat_load_pick(text,uuid) rename to heartbeat_load_pick_before_availability;
alter function public.heartbeat_load_pick_before_availability(text,uuid) set schema private;
create function public.heartbeat_load_pick(p_pick_id text,p_user_id uuid) returns jsonb
language sql stable set search_path='' as $$ select private.availability_snapshot(p_pick_id,private.heartbeat_load_pick_before_availability(p_pick_id,p_user_id)) $$;
revoke all on function public.heartbeat_load_pick(text,uuid) from public,anon,authenticated;
grant execute on function public.heartbeat_load_pick(text,uuid) to service_role;

alter function public.pick_refresh(text,uuid,jsonb) rename to pick_refresh_before_availability;
alter function public.pick_refresh_before_availability(text,uuid,jsonb) set schema private;
create function public.pick_refresh(p_pick_id text,p_user_id uuid,p_candidates jsonb) returns void
language plpgsql set search_path='' as $$ declare p public.picks; begin
 select * into p from public.picks where id=private.try_uuid(p_pick_id) for update;
 if p.proposed_at is not null then raise exception using errcode='PT409',message='Availability deck is fixed for this round'; end if;
 perform private.pick_refresh_before_availability(p_pick_id,p_user_id,p_candidates);
end $$;
-- Keep the agreed outing instant fixed. Attendance RSVP/outcome stay separate.
alter function public.pick_set_plan_time(text,uuid,timestamptz) rename to pick_plan_time_before_availability;
alter function public.pick_plan_time_before_availability(text,uuid,timestamptz) set schema private;
create function public.pick_set_plan_time(p_pick_id text,p_user_id uuid,p_plan_at timestamptz) returns uuid[]
language plpgsql set search_path='' as $$ declare p public.picks; begin
 p:=private.lock_pick_as_participant(p_pick_id,p_user_id);
 if p.proposed_at is not null then raise exception using errcode='PT409',message='This outing time was agreed before swiping'; end if;
 return private.pick_plan_time_before_availability(p_pick_id,p_user_id,p_plan_at);
end $$;
revoke all on function public.pick_create_options(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.pick_create_options(uuid,jsonb) to service_role;
revoke all on function public.pick_load_options(text,uuid) from public,anon,authenticated;
grant execute on function public.pick_load_options(text,uuid) to service_role;
revoke all on function public.pick_availability_load(text,uuid) from public,anon,authenticated;
grant execute on function public.pick_availability_load(text,uuid) to service_role;
revoke all on function public.pick_availability_respond(text,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.pick_availability_respond(text,uuid,integer,text) to service_role;
revoke all on function public.pick_availability_time(text,uuid,integer,timestamptz) from public,anon,authenticated;
grant execute on function public.pick_availability_time(text,uuid,integer,timestamptz) to service_role;
revoke all on function public.pick_availability_claim(text,uuid) from public,anon,authenticated;
grant execute on function public.pick_availability_claim(text,uuid) to service_role;
revoke all on function public.pick_availability_finish(text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.pick_availability_finish(text,uuid,uuid,jsonb) to service_role;
revoke all on function public.pick_availability_abort(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.pick_availability_abort(text,uuid,uuid) to service_role;
revoke all on function public.pick_start(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.pick_start(text,uuid,jsonb) to service_role;
revoke all on function public.pick_refresh(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.pick_refresh(text,uuid,jsonb) to service_role;
revoke all on function public.pick_set_plan_time(text,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.pick_set_plan_time(text,uuid,timestamptz) to service_role;
revoke all on function private.availability_edit(text,uuid,integer) from public,anon,authenticated;
grant execute on function private.availability_edit(text,uuid,integer) to service_role;
revoke all on function private.availability_snapshot(text,jsonb) from public,anon,authenticated;
grant execute on function private.availability_snapshot(text,jsonb) to service_role;
revoke all on function private.availability_ballot_guard() from public,anon,authenticated;
grant execute on function private.availability_ballot_guard() to service_role;
-- Revoke scheduled-Pick access and ballots in the same transaction as security changes.
create function private.availability_revoke_group() returns trigger
language plpgsql security definer set search_path='' as $$ begin
 update public.picks set state='canceled' where proposed_at is not null and group_id=old.group_id and host_id=old.user_id and state not in ('completed','canceled');
 delete from public.pick_participants pp using public.picks p where pp.pick_id=p.id and p.proposed_at is not null and p.group_id=old.group_id and p.state not in ('completed','canceled') and pp.user_id=old.user_id;
 return old;
end $$;
create trigger availability_revoke_group after delete on public.group_members for each row execute function private.availability_revoke_group();
create function private.availability_revoke_block() returns trigger
language plpgsql security definer set search_path='' as $$ begin
 delete from public.pick_participants pp using public.picks p where pp.pick_id=p.id and p.proposed_at is not null and p.state not in ('completed','canceled')
  and ((p.host_id=new.blocker_id and pp.user_id=new.blocked_id) or (p.host_id=new.blocked_id and pp.user_id=new.blocker_id));
 return new;
end $$;
create trigger availability_revoke_block after insert on public.blocks for each row execute function private.availability_revoke_block();
revoke all on function private.availability_revoke_group(),private.availability_revoke_block() from public,anon,authenticated;

create function private.availability_group_deleted() returns trigger
language plpgsql security definer set search_path='' as $$ begin
 update public.picks set state='canceled' where group_id=old.id and proposed_at is not null and state not in ('completed','canceled');
 return old;
end $$;
create trigger availability_group_deleted before delete on public.groups for each row execute function private.availability_group_deleted();
revoke all on function private.availability_group_deleted() from public,anon,authenticated;

-- Invitees retain results access but do not receive a swipe deck before reveal.
create policy "availability: deck access" on public.pick_candidates as restrictive for select to authenticated
 using (not exists(select 1 from public.picks p where p.id=pick_id and p.proposed_at is not null and p.state in ('draft','swiping'))
  or private.availability_voter(pick_id,(select auth.uid())));
