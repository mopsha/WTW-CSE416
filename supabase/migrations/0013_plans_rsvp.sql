-- After the winner: plan time, RSVP, "Did you go?"; plus history, "Pick again" and the
-- per-finalist answer counts behind the plain-language reasons (Alan, M4).
-- Contract: supabase/functions/_shared/api/plans.ts, supabase/functions/api/plansStore.ts,
-- docs/api-integration.md.
--
-- Same discipline as 0002–0009: clients only SELECT; every write is a SECURITY INVOKER RPC
-- executable only by service_role that locks the Pick row and rechecks who may do what.
--
-- Groups (Razin's 0012: picks.group_id, group_members) may land before or after this file,
-- so nothing here names them statically: PL/pgSQL resolves them only when a group is asked
-- for, and the column check below makes "Pick again" keep the group only when it exists.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
alter table public.picks add column plan_at timestamptz;

create table public.pick_rsvps (
  pick_id uuid not null references public.picks (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null check (status in ('going', 'maybe', 'not_going')),
  updated_at timestamptz not null default now(),
  constraint pick_rsvps_pick_user_key unique (pick_id, user_id)
);
comment on table public.pick_rsvps is 'Going / maybe / not going, once a Pick has a winner.';

create table public.pick_outcomes (
  pick_id uuid not null references public.picks (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  went boolean not null,
  again boolean,
  answered_at timestamptz not null default now(),
  constraint pick_outcomes_pick_user_key unique (pick_id, user_id)
);
comment on table public.pick_outcomes is '"Did you go?" answers: the success metric for the loop.';

alter table public.pick_rsvps enable row level security;
alter table public.pick_outcomes enable row level security;

create policy "pick_rsvps: participants" on public.pick_rsvps
  for select to authenticated
  using (private.is_pick_participant(pick_id));
create policy "pick_outcomes: participants" on public.pick_outcomes
  for select to authenticated
  using (private.is_pick_participant(pick_id));

revoke all on table public.pick_rsvps, public.pick_outcomes from anon, authenticated;
grant select on table public.pick_rsvps, public.pick_outcomes to authenticated;
grant all on table public.pick_rsvps, public.pick_outcomes to service_role;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- Locks the Pick and checks the caller is in it. PT404 for a stranger, so a Pick id says
-- nothing to someone who isn't in it.
create function private.lock_pick_as_participant(p_pick_id text, p_user_id uuid)
returns public.picks
language plpgsql
set search_path = ''
as $$
declare
  v_pick public.picks%rowtype;
begin
  select * into v_pick from public.picks where id = private.try_uuid(p_pick_id) for update;
  if not found or not exists (
    select 1 from public.pick_participants where pick_id = v_pick.id and user_id = p_user_id
  ) then
    raise exception using errcode = 'PT404', message = 'Pick not found';
  end if;
  return v_pick;
end;
$$;
revoke all on function private.lock_pick_as_participant(text, uuid) from public, anon, authenticated;
grant execute on function private.lock_pick_as_participant(text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Plan time, RSVP, outcome
-- ---------------------------------------------------------------------------
-- Host only, completed Picks only. Returns everyone else in the Pick (for notify).
create function public.pick_set_plan_time(p_pick_id text, p_user_id uuid, p_plan_at timestamptz)
returns uuid[]
language plpgsql
set search_path = ''
as $$
declare
  v_pick public.picks%rowtype := private.lock_pick_as_participant(p_pick_id, p_user_id);
begin
  if v_pick.host_id <> p_user_id then
    raise exception using errcode = 'PT403', message = 'Only the host can set the time';
  end if;
  if v_pick.state <> 'completed' then
    raise exception using errcode = 'PT409', message = 'The Pick has no winner yet';
  end if;
  update public.picks set plan_at = p_plan_at where id = v_pick.id;
  -- A moved time is a new plan: the reminder and "did you go?" may go out again.
  delete from public.notifications
    where pick_id = v_pick.id and type in ('plan_reminder', 'did_you_go');
  return array(
    select user_id from public.pick_participants
    where pick_id = v_pick.id and user_id <> p_user_id order by user_id
  );
end;
$$;

create function public.pick_rsvp(p_pick_id text, p_user_id uuid, p_status text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_pick public.picks%rowtype := private.lock_pick_as_participant(p_pick_id, p_user_id);
begin
  if v_pick.state <> 'completed' then
    raise exception using errcode = 'PT409', message = 'The Pick has no winner yet';
  end if;
  insert into public.pick_rsvps (pick_id, user_id, status) values (v_pick.id, p_user_id, p_status)
  on conflict (pick_id, user_id) do update set status = excluded.status, updated_at = now();
exception
  when check_violation then
    raise exception using errcode = 'PT400', message = 'Invalid RSVP';
end;
$$;

create function public.pick_outcome(p_pick_id text, p_user_id uuid, p_went boolean, p_again boolean)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_pick public.picks%rowtype := private.lock_pick_as_participant(p_pick_id, p_user_id);
begin
  if v_pick.state <> 'completed' then
    raise exception using errcode = 'PT409', message = 'The Pick has no winner yet';
  end if;
  insert into public.pick_outcomes (pick_id, user_id, went, again)
  values (v_pick.id, p_user_id, p_went, p_again)
  on conflict (pick_id, user_id) do update
    set went = excluded.went, again = excluded.again, answered_at = now();
end;
$$;

-- Everything the Winner screen's plan block needs. Counts only: who said what is not shown.
create function public.pick_plan_load(p_pick_id text, p_user_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_pick public.picks%rowtype;
begin
  select * into v_pick from public.picks where id = private.try_uuid(p_pick_id);
  if not found or not exists (
    select 1 from public.pick_participants where pick_id = v_pick.id and user_id = p_user_id
  ) then
    raise exception using errcode = 'PT404', message = 'Pick not found';
  end if;
  return jsonb_build_object(
    'state', v_pick.state,
    'isHost', v_pick.host_id = p_user_id,
    'planAt', v_pick.plan_at,
    'participantCount', (select count(*) from public.pick_participants where pick_id = v_pick.id),
    'rsvps', jsonb_build_object(
      'going', (select count(*) from public.pick_rsvps where pick_id = v_pick.id and status = 'going'),
      'maybe', (select count(*) from public.pick_rsvps where pick_id = v_pick.id and status = 'maybe'),
      'notGoing', (select count(*) from public.pick_rsvps where pick_id = v_pick.id and status = 'not_going')
    ),
    'myRsvp', (select status from public.pick_rsvps where pick_id = v_pick.id and user_id = p_user_id),
    'outcomes', jsonb_build_object(
      'went', (select count(*) from public.pick_outcomes where pick_id = v_pick.id and went),
      'didNotGo', (select count(*) from public.pick_outcomes where pick_id = v_pick.id and not went),
      'again', (select count(*) from public.pick_outcomes where pick_id = v_pick.id and again)
    ),
    'myOutcome', (
      select jsonb_build_object('went', went, 'again', again)
      from public.pick_outcomes where pick_id = v_pick.id and user_id = p_user_id
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- History (FR-18) and "Pick again"
-- ---------------------------------------------------------------------------
-- Completed Picks I was in, newest first: winner, finalists by rank (no scores, never anyone's
-- answers), participants, plan time, how many went. With p_group_id: that group's Picks,
-- and only if I'm a member (PT404 otherwise, or if groups aren't installed).
create function public.pick_history(p_user_id uuid, p_group_id uuid default null)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_member boolean;
begin
  if p_group_id is not null then
    if to_regclass('public.group_members') is null then
      raise exception using errcode = 'PT404', message = 'Group not found';
    end if;
    execute 'select exists (select 1 from public.group_members where group_id = $1 and user_id = $2)'
      into v_member using p_group_id, p_user_id;
    if not v_member then
      raise exception using errcode = 'PT404', message = 'Group not found';
    end if;
  end if;

  return coalesce((
    select jsonb_agg(item order by decided_at desc, id)
    from (
      select p.id, p.decided_at, jsonb_build_object(
        'id', p.id,
        'category', p.category,
        'decidedAt', p.decided_at,
        'decidedBy', p.decided_by,
        'planAt', p.plan_at,
        'groupId', to_jsonb(p) ->> 'group_id',
        'winner', (
          select jsonb_build_object('placeId', c.place_id, 'name', c.snapshot ->> 'name')
          from public.pick_candidates c where c.pick_id = p.id and c.place_id = p.winner_place_id
        ),
        'finalists', coalesce((
          select jsonb_agg(jsonb_build_object(
            'placeId', r.place_id, 'rank', r.rank, 'name', c.snapshot ->> 'name') order by r.rank)
          from public.ranking_results r
          join public.pick_candidates c on c.pick_id = r.pick_id and c.place_id = r.place_id
          where r.pick_id = p.id and r.rank <= 3
        ), '[]'::jsonb),
        'participants', coalesce((
          select jsonb_agg(jsonb_build_object('userId', pp.user_id, 'displayName', pr.display_name)
            order by pp.joined_at)
          from public.pick_participants pp
          join public.profiles pr on pr.id = pp.user_id
          where pp.pick_id = p.id
        ), '[]'::jsonb),
        'wentCount', (select count(*) from public.pick_outcomes o where o.pick_id = p.id and o.went)
      ) as item
      from public.picks p
      join public.pick_participants me on me.pick_id = p.id and me.user_id = p_user_id
      where p.state = 'completed'
        and (p_group_id is null or (to_jsonb(p) ->> 'group_id')::uuid = p_group_id)
      order by p.decided_at desc, p.id
      limit 50
    ) h
  ), '[]'::jsonb);
end;
$$;

-- A new draft with the same people and settings; the caller hosts it. Works from any Pick the
-- caller was in that is over (completed or canceled). Returns the new id and who was added.
create function public.pick_again(p_pick_id text, p_user_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_old public.picks%rowtype := private.lock_pick_as_participant(p_pick_id, p_user_id);
  v_new uuid;
  v_added uuid[];
begin
  if v_old.state not in ('completed', 'canceled') then
    raise exception using errcode = 'PT409', message = 'This Pick is still going';
  end if;
  v_new := (public.pick_create(p_user_id, v_old.category, v_old.center_lat, v_old.center_lng,
    v_old.radius_m, v_old.pool_size, null, v_old.close_threshold) ->> 'id')::uuid;

  with added as (
    insert into public.pick_participants (pick_id, user_id)
    select v_new, user_id from public.pick_participants
    where pick_id = v_old.id and user_id <> p_user_id
    on conflict do nothing
    returning user_id
  )
  select coalesce(array_agg(user_id order by user_id), '{}') into v_added from added;

  if exists (
    select 1 from pg_attribute
    where attrelid = 'public.picks'::regclass and attname = 'group_id' and not attisdropped
  ) then
    execute 'update public.picks set group_id = $1 where id = $2'
      using (to_jsonb(v_old) ->> 'group_id')::uuid, v_new;
  end if;

  return jsonb_build_object('id', v_new, 'addedUserIds', to_jsonb(v_added));
end;
$$;

-- ---------------------------------------------------------------------------
-- Reasons (FR-14): per-finalist answer counts, only once the Pick has closed.
-- ---------------------------------------------------------------------------
create function public.pick_finalist_counts(p_pick_id text, p_user_id uuid)
returns table (place_id text, rank integer, yes integer, maybe integer, no integer, n integer)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_pick public.picks%rowtype;
  v_n integer;
begin
  select * into v_pick from public.picks where id = private.try_uuid(p_pick_id);
  if not found or not exists (
    select 1 from public.pick_participants where pick_id = v_pick.id and user_id = p_user_id
  ) then
    raise exception using errcode = 'PT404', message = 'Pick not found';
  end if;
  if v_pick.state not in ('final_vote', 'completed') then
    raise exception using errcode = 'PT409', message = 'The Pick has not closed yet';
  end if;
  select count(*) into v_n from public.pick_participants where pick_id = v_pick.id;
  return query
    select r.place_id, r.rank,
      (count(*) filter (where pr.value = 2))::integer,
      (count(*) filter (where pr.value = 1))::integer,
      (count(*) filter (where pr.value = 0))::integer,
      v_n
    from public.ranking_results r
    left join public.preferences pr on pr.pick_id = r.pick_id and pr.place_id = r.place_id
    where r.pick_id = v_pick.id and r.rank <= 3
    group by r.place_id, r.rank
    order by r.rank;
end;
$$;

-- ---------------------------------------------------------------------------
-- Sweep targets: plan reminder (1 h before) and "Did you go?" (3 h after the plan time, or
-- 24 h after the decision when no time was set; only for Picks decided in the last 14 days).
-- Everyone in the Pick except people who said they're not going, who answered already, or
-- who were already told. notify_insert's unique index is the real once-only guard.
-- ---------------------------------------------------------------------------
create function public.pick_plan_targets(p_now timestamptz)
returns table (pick_id uuid, kind text, user_ids uuid[])
language sql
stable
set search_path = ''
as $$
  with due as (
    select p.id, 'plan_reminder'::text as kind from public.picks p
    where p.state = 'completed' and p.plan_at > p_now and p.plan_at <= p_now + interval '1 hour'
    union all
    select p.id, 'did_you_go' from public.picks p
    where p.state = 'completed' and p.decided_at > p_now - interval '14 days'
      and coalesce(p.plan_at + interval '3 hours', p.decided_at + interval '24 hours') <= p_now
  )
  select d.id, d.kind, array_agg(pp.user_id order by pp.user_id)
  from due d
  join public.pick_participants pp on pp.pick_id = d.id
  where not exists (
      select 1 from public.pick_rsvps r
      where r.pick_id = d.id and r.user_id = pp.user_id and r.status = 'not_going')
    and not exists (
      select 1 from public.notifications n
      where n.pick_id = d.id and n.user_id = pp.user_id and n.type = d.kind)
    and (d.kind <> 'did_you_go' or not exists (
      select 1 from public.pick_outcomes o where o.pick_id = d.id and o.user_id = pp.user_id))
  group by d.id, d.kind
  order by d.id, d.kind
  limit 200;
$$;

revoke all on function public.pick_set_plan_time(text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.pick_rsvp(text, uuid, text) from public, anon, authenticated;
revoke all on function public.pick_outcome(text, uuid, boolean, boolean) from public, anon, authenticated;
revoke all on function public.pick_plan_load(text, uuid) from public, anon, authenticated;
revoke all on function public.pick_history(uuid, uuid) from public, anon, authenticated;
revoke all on function public.pick_again(text, uuid) from public, anon, authenticated;
revoke all on function public.pick_finalist_counts(text, uuid) from public, anon, authenticated;
revoke all on function public.pick_plan_targets(timestamptz) from public, anon, authenticated;
grant execute on function public.pick_set_plan_time(text, uuid, timestamptz) to service_role;
grant execute on function public.pick_rsvp(text, uuid, text) to service_role;
grant execute on function public.pick_outcome(text, uuid, boolean, boolean) to service_role;
grant execute on function public.pick_plan_load(text, uuid) to service_role;
grant execute on function public.pick_history(uuid, uuid) to service_role;
grant execute on function public.pick_again(text, uuid) to service_role;
grant execute on function public.pick_finalist_counts(text, uuid) to service_role;
grant execute on function public.pick_plan_targets(timestamptz) to service_role;
