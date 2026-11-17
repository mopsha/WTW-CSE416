-- 0044 (taste) and 0045 (photo limits) are reserved by parallel PRs.
-- Suggestions extend canonical plan_at / pick_rsvps, not pre-swipe availability.
alter table public.picks add column schedule_revision integer not null default 0,
 add column suggestion_group_required boolean;
-- Hostless history is immutable and cannot participate in suggestion scheduling.
-- Leave its provenance unknown rather than firing the existing hostless guard.
update public.picks set suggestion_group_required=true where group_id is not null and host_id is not null;
alter table public.picks alter column suggestion_group_required set default false;
-- NULL denotes legacy group-less history whose deleted-group provenance cannot
-- be proved. Suggestions fail closed there; existing plan controls remain available.
-- Preserve group provenance when deletion nulls group_id; history access must not
-- accidentally become permission to propose times as a nongroup participant.
create function private.suggestion_group_provenance() returns trigger
language plpgsql set search_path='' as $$ begin
 if tg_op='INSERT' then new.suggestion_group_required:=new.group_id is not null;
 else new.suggestion_group_required:=old.suggestion_group_required or old.group_id is not null or new.group_id is not null;
 end if;
 return new;
end $$;
revoke all on function private.suggestion_group_provenance() from public,anon,authenticated;
create trigger suggestion_group_provenance before insert or update of group_id on public.picks
 for each row execute function private.suggestion_group_provenance();
create table public.pick_time_suggestions (
 id uuid primary key default gen_random_uuid(),
 pick_id uuid not null references public.picks(id) on delete cascade,
 proposer_id uuid not null references public.profiles(id) on delete cascade,
 plan_at timestamptz not null,
 base_revision integer not null,
 status text not null default 'pending' check(status in ('pending','accepted','withdrawn','superseded')),
 created_at timestamptz not null default clock_timestamp(),
 unique(pick_id,base_revision,plan_at)
);
create unique index time_suggestions_one_pending on public.pick_time_suggestions(pick_id,proposer_id) where status='pending';
create index time_suggestions_pick on public.pick_time_suggestions(pick_id,created_at desc);

-- Completed-Pick history access is deliberately broader than permission to reschedule.
create function private.time_suggestion_access(p_id uuid,p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.picks p join public.pick_participants pp on pp.pick_id=p.id
 where p.id=p_id and pp.user_id=p_user and p.state='completed' and p.proposed_at is not null
 and p.plan_at is not null and ((p.group_id is null and not p.suggestion_group_required) or exists(select 1 from public.group_members gm where gm.group_id=p.group_id and gm.user_id=p_user))
 and p.host_id is not null and not private.is_blocked_between(p.host_id,p_user))
$$;
revoke all on function private.time_suggestion_access(uuid,uuid) from public,anon,authenticated;
grant execute on function private.time_suggestion_access(uuid,uuid) to service_role;
alter table public.pick_time_suggestions enable row level security;
revoke all on public.pick_time_suggestions from public,anon,authenticated;
grant select on public.pick_time_suggestions to authenticated;
grant all on public.pick_time_suggestions to service_role;
create function private.time_suggestion_visible(p_id uuid,p_proposer uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select private.time_suggestion_access(p_id,(select auth.uid())) and private.time_suggestion_access(p_id,p_proposer)
 and not private.is_blocked_between(p_proposer,(select auth.uid()))
$$;
revoke all on function private.time_suggestion_visible(uuid,uuid) from public,anon;
grant execute on function private.time_suggestion_visible(uuid,uuid) to authenticated,service_role;
create policy "authorized schedule suggestions" on public.pick_time_suggestions for select to authenticated
 using(private.time_suggestion_visible(pick_id,proposer_id));


-- Includes direct host rescheduling, old clients, and accepted suggestions.
create function private.schedule_revision_changed() returns trigger
language plpgsql set search_path='' as $$ begin
 if new.plan_at is distinct from old.plan_at then
  new.schedule_revision:=old.schedule_revision+1;
  update public.pick_time_suggestions set status='superseded' where pick_id=old.id and status='pending';
 end if;
 return new;
end $$;
revoke all on function private.schedule_revision_changed() from public,anon,authenticated;
create trigger schedule_revision_changed before update of plan_at on public.picks for each row execute function private.schedule_revision_changed();

create function public.pick_time_suggestions_load(p_pick_id text,p_user_id uuid) returns jsonb
language plpgsql stable set search_path='' as $$ declare p public.picks; begin
 select * into p from public.picks where id=private.try_uuid(p_pick_id);
 if not found or not private.time_suggestion_access(p.id,p_user_id) then raise exception using errcode='PT404',message='Pick not found'; end if;
 return jsonb_build_object('revision',p.schedule_revision,'planAt',p.plan_at,'isHost',p.host_id=p_user_id,
 'suggestions',coalesce((with visible as (
 select s.id,s.created_at,
  (s.status='pending' and s.base_revision=p.schedule_revision and s.plan_at>statement_timestamp()) as actionable,
  jsonb_build_object('id',s.id,'proposerId',s.proposer_id,'displayName',pr.display_name,'planAt',s.plan_at,
   'status',case when s.status='pending' and s.plan_at<=statement_timestamp() then 'expired' else s.status end,
   'revision',s.base_revision) as row
 from public.pick_time_suggestions s join public.profiles pr on pr.id=s.proposer_id where s.pick_id=p.id
 and private.time_suggestion_access(p.id,s.proposer_id) and not private.is_blocked_between(p_user_id,s.proposer_id)
 ), selected as (
  -- The existing 100-per-revision mutation cap bounds this complete pending set.
  select * from visible where actionable
  union all
  (select * from visible where not actionable order by created_at desc,id limit 50)
 ) select jsonb_agg(row order by actionable desc,created_at desc,id) from selected),'[]'::jsonb));
end $$;

-- One pending proposal per person; choosing another time supersedes their old one.
-- Same-time retries return the same row, including withdrawn rows (never resurrected).
create function public.pick_time_suggest(p_pick_id text,p_user_id uuid,p_revision integer,p_plan_at timestamptz) returns jsonb
language plpgsql set search_path='' as $$ declare p public.picks; s public.pick_time_suggestions; begin
 p:=private.lock_pick_as_participant(p_pick_id,p_user_id);
 if not private.time_suggestion_access(p.id,p_user_id) then raise exception using errcode='PT404',message='Pick not found'; end if;
 if p.schedule_revision is distinct from p_revision then raise exception using errcode='PT409',message='Schedule changed. Refresh before suggesting a time.'; end if;
 if p_plan_at is null or p_plan_at<=clock_timestamp() or p_plan_at>clock_timestamp()+interval '30 days' or p_plan_at=p.plan_at then raise exception using errcode='PT400',message='Choose a different future time within 30 days'; end if;
 select * into s from public.pick_time_suggestions where pick_id=p.id and base_revision=p_revision and plan_at=p_plan_at;
 if found then
  if not private.time_suggestion_access(p.id,s.proposer_id) or private.is_blocked_between(p_user_id,s.proposer_id) then raise exception using errcode='PT409',message='That time was already proposed. Choose another time.'; end if;
  return jsonb_build_object('id',s.id,'notifyUserIds',array[p.host_id]);
 end if;
 if (select count(*) from public.pick_time_suggestions where pick_id=p.id and base_revision=p_revision)>=100 then raise exception using errcode='PT409',message='Too many suggestions for this schedule'; end if;
 update public.pick_time_suggestions set status='superseded' where pick_id=p.id and proposer_id=p_user_id and status='pending';
 insert into public.pick_time_suggestions(pick_id,proposer_id,base_revision,plan_at) values(p.id,p_user_id,p_revision,p_plan_at) returning * into s;
 return jsonb_build_object('id',s.id,'notifyUserIds',array[p.host_id]);
end $$;

create function public.pick_time_suggestion_act(p_pick_id text,p_user_id uuid,p_suggestion_id uuid,p_revision integer,p_action text) returns jsonb
language plpgsql set search_path='' as $$ declare p public.picks; s public.pick_time_suggestions; recipients uuid[]; begin
 p:=private.lock_pick_as_participant(p_pick_id,p_user_id);
 if not private.time_suggestion_access(p.id,p_user_id) then raise exception using errcode='PT404',message='Pick not found'; end if;
 if p_action is null or p_action not in ('accept','withdraw') then raise exception using errcode='PT400',message='Invalid suggestion action'; end if;
 select * into s from public.pick_time_suggestions where id=p_suggestion_id and pick_id=p.id for update;
 if not found or not private.time_suggestion_access(p.id,s.proposer_id) or private.is_blocked_between(p_user_id,s.proposer_id) then raise exception using errcode='PT404',message='Suggestion not found'; end if;
 if p_action='withdraw' and s.proposer_id is distinct from p_user_id then raise exception using errcode='PT403',message='Only the proposer can withdraw'; end if;
 if p_action='accept' and p.host_id is distinct from p_user_id then raise exception using errcode='PT403',message='Host only'; end if;
 if s.base_revision is distinct from p_revision then raise exception using errcode='PT409',message='Schedule changed. Refresh this Pick.'; end if;
 if p_action='accept' and s.status='accepted' and p.schedule_revision=s.base_revision+1 and p.plan_at=s.plan_at then return jsonb_build_object('id',s.id,'notifyUserIds',array(select user_id from public.pick_participants where pick_id=p.id and user_id<>p_user_id)); end if;
 if p_action='withdraw' and s.status='withdrawn' and p.schedule_revision=s.base_revision then return jsonb_build_object('id',s.id); end if;
 if p.schedule_revision<>s.base_revision or s.status<>'pending' then raise exception using errcode='PT409',message='This suggestion is no longer current'; end if;
 if p_action='withdraw' then
  update public.pick_time_suggestions set status='withdrawn' where id=s.id;
 else
  if s.plan_at<=clock_timestamp() or s.plan_at>clock_timestamp()+interval '30 days' then raise exception using errcode='PT409',message='This suggested time has expired'; end if;
  -- Canonical host authorization, change limit, reminder reset and final-RSVP clearing.
  recipients:=public.pick_set_plan_time(p_pick_id,p_user_id,s.plan_at);
  update public.pick_time_suggestions set status='accepted' where id=s.id;
 end if;
 return jsonb_build_object('id',s.id,'notifyUserIds',case when p_action='accept' then coalesce(recipients,'{}'::uuid[]) else '{}'::uuid[] end);
end $$;

-- Optional projection: older clients safely ignore it; unscheduled controls are unchanged.
alter function public.pick_plan_load(text,uuid) rename to pick_plan_before_time_suggestions;
alter function public.pick_plan_before_time_suggestions(text,uuid) set schema private;
create function public.pick_plan_load(p_pick_id text,p_user_id uuid) returns jsonb
language plpgsql stable set search_path='' as $$ declare result jsonb; begin
 result:=private.pick_plan_before_time_suggestions(p_pick_id,p_user_id);
 if exists(select 1 from public.picks where id=private.try_uuid(p_pick_id) and proposed_at is not null) then
 result:=result||jsonb_build_object('scheduleRevision',(select schedule_revision from public.picks where id=private.try_uuid(p_pick_id))); end if;
 if private.time_suggestion_access(private.try_uuid(p_pick_id),p_user_id) then return result||jsonb_build_object('timeSuggestionsAllowed',true); end if;
 return result;
end $$;

revoke all on function public.pick_time_suggestions_load(text,uuid),public.pick_time_suggest(text,uuid,integer,timestamptz),public.pick_time_suggestion_act(text,uuid,uuid,integer,text),public.pick_plan_load(text,uuid) from public,anon,authenticated;
grant execute on function public.pick_time_suggestions_load(text,uuid),public.pick_time_suggest(text,uuid,integer,timestamptz),public.pick_time_suggestion_act(text,uuid,uuid,integer,text),public.pick_plan_load(text,uuid) to service_role;

-- Reuse the inbox/push pipeline; deduplicate each suggestion event, not just each Pick.
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check(type in (
 'added_to_pick','pick_started','reminder','vote_needed','winner_decided','pick_canceled','plan_time_set','plan_reminder','did_you_go','group_invite','group_message','direct_message','time_suggested'));
drop index public.notifications_once_per_pick;
create unique index notifications_once_per_pick on public.notifications(user_id,pick_id,type) where pick_id is not null and type not in ('plan_time_set','time_suggested');
create unique index notifications_time_suggestion_event on public.notifications(user_id,(payload->>'timeSuggestionEvent')) where payload ? 'timeSuggestionEvent';
-- Keep the legacy leaf's behavior, updating conflict inference for the extended index.
create or replace function private.notify_insert_before_group_invites(p_user_ids uuid[],p_type text,p_pick_id uuid,p_payload jsonb) returns setof uuid
language sql set search_path='' as $$
 insert into public.notifications(user_id,type,pick_id,payload)
 select ids.u,p_type,p_pick_id,coalesce(p_payload,'{}'::jsonb) from (select distinct unnest(p_user_ids) as u) ids
 where exists(select 1 from public.profiles where id=ids.u)
 on conflict do nothing returning user_id
$$;
alter function public.notify_insert(uuid[],text,uuid,jsonb) rename to notify_before_time_suggestions;
alter function public.notify_before_time_suggestions(uuid[],text,uuid,jsonb) set schema private;
create function public.notify_insert(p_user_ids uuid[],p_type text,p_pick_id uuid,p_payload jsonb) returns setof uuid
language plpgsql set search_path='' as $$ declare p public.picks; s public.pick_time_suggestions; begin
 if p_type<>'time_suggested' and not (p_type='plan_time_set' and coalesce(p_payload ? 'timeSuggestionId',false)) then
  return query select * from private.notify_before_time_suggestions(p_user_ids,p_type,p_pick_id,p_payload); return;
 end if;
 select * into p from public.picks where id=p_pick_id for update;
 select * into s from public.pick_time_suggestions where id=private.try_uuid(p_payload->>'timeSuggestionId') and pick_id=p.id;
 if not found then return; end if;
 if p_type='time_suggested' then
  if not private.time_suggestion_access(p.id,s.proposer_id) then return; end if;
  if s.status<>'pending' or s.base_revision<>p.schedule_revision then return; end if;
  return query insert into public.notifications(user_id,type,pick_id,payload)
   select p.host_id,p_type,p.id,jsonb_build_object('timeSuggestionEvent','suggested:'||s.id,'timeSuggestionId',s.id)
   where p.host_id=any(p_user_ids) and private.time_suggestion_access(p.id,p.host_id)
   on conflict do nothing returning user_id;
 else
  if s.status<>'accepted' or p.schedule_revision<>s.base_revision+1 or p.plan_at<>s.plan_at then return; end if;
  return query insert into public.notifications(user_id,type,pick_id,payload)
   select pp.user_id,p_type,p.id,jsonb_build_object('timeSuggestionEvent','accepted:'||s.id,'timeSuggestionId',s.id,'reconfirmRsvp',true)
   from public.pick_participants pp where pp.pick_id=p.id and pp.user_id=any(p_user_ids)
   and private.time_suggestion_access(p.id,pp.user_id)
   on conflict do nothing returning user_id;
 end if;
end $$;
revoke all on function public.notify_insert(uuid[],text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.notify_insert(uuid[],text,uuid,jsonb) to service_role;


-- Updated clients confirm the schedule they actually saw. Legacy API writes remain
-- unchanged until a scheduled reschedule; rescheduled plans always require revision,
-- even if the suggestion flag is later disabled. Ordinary Picks keep their old behavior.
alter function public.pick_rsvp(text,uuid,text) rename to pick_rsvp_before_time_suggestions;
alter function public.pick_rsvp_before_time_suggestions(text,uuid,text) set schema private;
create function public.pick_rsvp(p_pick_id text,p_user_id uuid,p_status text) returns void
language plpgsql set search_path='' as $$ declare p public.picks; begin
 p:=private.lock_pick_as_participant(p_pick_id,p_user_id);
 if p.proposed_at is not null and p.plan_time_changes>0 then raise exception using errcode='PT409',message='The plan time changed. Update WTW and RSVP again.'; end if;
 perform private.pick_rsvp_before_time_suggestions(p_pick_id,p_user_id,p_status);
end $$;
revoke all on function public.pick_rsvp(text,uuid,text) from public,anon,authenticated;
grant execute on function public.pick_rsvp(text,uuid,text) to service_role;

create function public.pick_rsvp(p_pick_id text,p_user_id uuid,p_status text,p_revision integer) returns void
language plpgsql set search_path='' as $$ declare p public.picks; begin
 p:=private.lock_pick_as_participant(p_pick_id,p_user_id);
 if p.proposed_at is not null and (not private.availability_access(p.id,p_user_id)
 or (p.group_id is not null and not exists(select 1 from public.group_members where group_id=p.group_id and user_id=p_user_id))
 or (p.group_id is null and p.suggestion_group_required is true)) then raise exception using errcode='PT404',message='Pick not found'; end if;
 if p.proposed_at is not null and p.schedule_revision is distinct from p_revision then raise exception using errcode='PT409',message='The plan time changed. Refresh and RSVP again.'; end if;
 perform private.pick_rsvp_before_time_suggestions(p_pick_id,p_user_id,p_status);
end $$;
revoke all on function public.pick_rsvp(text,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.pick_rsvp(text,uuid,text,integer) to service_role;

-- Completed Picks retain their historical roster. Serialize current group/block
-- revocation with scheduling anyway, without deleting that history.
create function private.time_suggestion_group_revoked() returns trigger
language plpgsql security definer set search_path='' as $$ declare p public.picks; begin
 for p in select q.* from public.picks q where q.group_id=old.group_id and q.state='completed' and q.proposed_at is not null
 and exists(select 1 from public.pick_participants pp where pp.pick_id=q.id and pp.user_id=old.user_id) order by q.id for update loop
  update public.pick_time_suggestions set status='superseded' where pick_id=p.id and proposer_id=old.user_id and status='pending';
 end loop;
 return old;
end $$;
create trigger time_suggestion_group_revoked after delete on public.group_members for each row execute function private.time_suggestion_group_revoked();
create function private.time_suggestion_blocked() returns trigger
language plpgsql security definer set search_path='' as $$ declare p public.picks; revoked uuid; begin
 for p in select q.* from public.picks q where q.state='completed' and q.proposed_at is not null and q.host_id in (new.blocker_id,new.blocked_id)
 and exists(select 1 from public.pick_participants pp where pp.pick_id=q.id and pp.user_id=case when q.host_id=new.blocker_id then new.blocked_id else new.blocker_id end)
 order by q.id for update loop
  revoked:=case when p.host_id=new.blocker_id then new.blocked_id else new.blocker_id end;
  update public.pick_time_suggestions set status='superseded' where pick_id=p.id and proposer_id=revoked and status='pending';
 end loop;
 return new;
end $$;
create trigger time_suggestion_blocked after insert on public.blocks for each row execute function private.time_suggestion_blocked();
revoke all on function private.time_suggestion_group_revoked(),private.time_suggestion_blocked() from public,anon,authenticated;
