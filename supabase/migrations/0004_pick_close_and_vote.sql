-- Closing the swiping phase, and the final vote (Alan). Week 3.
-- Contract: supabase/functions/_shared/api/closing.ts, voting.ts.
--
-- Same discipline as 0002/0003: SECURITY INVOKER, executable only by
-- service_role, SQLSTATE PT400 / PT403 / PT404 / PT409, a row lock before
-- any read-then-write.

-- The swipe deadline (deadline_at) has usually passed by the time a vote starts,
-- so the vote gets its own deadline, set when the Pick enters final_vote.
alter table public.picks add column vote_deadline_at timestamptz;
comment on column public.picks.vote_deadline_at is 'When the final vote closes. Set by pick_close_apply on entering final_vote; null otherwise.';

create table public.final_votes (
  pick_id uuid not null,
  user_id uuid not null,
  place_id text not null,
  created_at timestamptz not null default now(),
  primary key (pick_id, user_id),
  foreign key (pick_id, place_id) references public.pick_candidates (pick_id, place_id) on delete cascade,
  foreign key (pick_id, user_id) references public.pick_participants (pick_id, user_id) on delete cascade
);
comment on table public.final_votes is 'One changeable ballot per participant among the finalists. Private to its author until the vote closes.';

alter table public.final_votes enable row level security;
create policy "final_votes: only my own" on public.final_votes
  for select to authenticated
  using (user_id = (select auth.uid()));

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
revoke all on table public.final_votes from anon, authenticated;
grant select on table public.final_votes to authenticated;
grant all on table public.final_votes to service_role;

-- ---------------------------------------------------------------------------
-- 1. pick_load_for_close: everything closePick() needs to rank and decide.
-- ---------------------------------------------------------------------------
create function public.pick_load_for_close(p_pick_id text)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_id uuid := private.try_uuid(p_pick_id);
begin
  return (
    select jsonb_build_object(
      'id', p.id,
      'hostId', p.host_id,
      'state', p.state,
      'center', jsonb_build_object('lat', p.center_lat, 'lng', p.center_lng),
      'closeThreshold', p.close_threshold,
      'deadlineAt', p.deadline_at,
      'winnerPlaceId', p.winner_place_id,
      'version', p.version::text,
      'participantIds', coalesce((
        select jsonb_agg(pp.user_id order by pp.user_id)
        from public.pick_participants pp where pp.pick_id = p.id
      ), '[]'::jsonb),
      'candidates', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'placeId', c.place_id,
                 'lat', (c.snapshot ->> 'lat')::double precision,
                 'lng', (c.snapshot ->> 'lng')::double precision) order by c.place_id)
        from public.pick_candidates c where c.pick_id = p.id
      ), '[]'::jsonb),
      'preferences', coalesce((
        select jsonb_agg(jsonb_build_object('userId', pr.user_id, 'placeId', pr.place_id, 'value', pr.value))
        from public.preferences pr where pr.pick_id = p.id
      ), '[]'::jsonb),
      'finalistIds', coalesce((
        select jsonb_agg(r.place_id order by r.rank)
        from public.ranking_results r where r.pick_id = p.id and r.finalist
      ), '[]'::jsonb)
    )
    from public.picks p where p.id = v_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. pick_close_apply: swiping -> ranking -> completed | final_vote.
-- p_actor: 'host' | 'system'. 'host' rechecks p_actor_user_id = host_id;
-- 'system' (the auto-close check after a swipe, or a deadline sweep) only
-- rechecks state + version, since there is no per-request user to recheck.
-- ---------------------------------------------------------------------------
create function public.pick_close_apply(
  p_pick_id text, p_actor text, p_actor_user_id uuid, p_version text, p_ranking jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid := private.try_uuid(p_pick_id);
  v_pick public.picks%rowtype;
  v_target text := p_ranking ->> 'state';
  v_winner text := p_ranking ->> 'winnerPlaceId';
  v_vote_deadline timestamptz;
  v_rows jsonb := p_ranking -> 'rows';
  v_candidates integer;
  v_valid boolean;
begin
  if p_actor not in ('host', 'system') then
    raise exception using errcode = 'PT400', message = 'Invalid close actor';
  end if;

  select * into v_pick from public.picks where id = v_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'Pick not found';
  end if;
  if p_actor = 'host' and v_pick.host_id <> p_actor_user_id then
    raise exception using errcode = 'PT403', message = 'Only the host can close this Pick';
  end if;
  if v_pick.state <> 'swiping' or p_version is distinct from v_pick.version::text then
    raise exception using errcode = 'PT409', message = 'Pick changed; reload before trying again';
  end if;

  if jsonb_typeof(v_rows) is distinct from 'array' or v_target not in ('completed', 'final_vote') then
    raise exception using errcode = 'PT400', message = 'Invalid ranking payload';
  end if;
  select count(*) into v_candidates from public.pick_candidates where pick_id = v_id;

  select
    count(*) = v_candidates
    and count(distinct r.place_id) = v_candidates
    and count(distinct r.rank) = v_candidates
    and bool_and(c.place_id is not null)
    and bool_and(r.rank between 1 and v_candidates)
    and bool_and(coalesce(r.score between 0 and 100, false))
    and bool_and(r.finalist is not null)
    and (v_target <> 'completed' or (v_winner is not null and bool_or(r.place_id = v_winner and r.rank = 1)))
    and (v_target <> 'final_vote' or (v_winner is null and bool_or(r.finalist)))
  into v_valid
  from jsonb_to_recordset(v_rows) as r(place_id text, rank integer, score double precision, finalist boolean)
  left join public.pick_candidates c on c.pick_id = v_id and c.place_id = r.place_id;

  if v_candidates = 0 or not coalesce(v_valid, false) then
    raise exception using errcode = 'PT400', message = 'Ranking does not match the candidate pool';
  end if;

  if v_target = 'final_vote' then
    begin
      v_vote_deadline := (p_ranking ->> 'voteDeadlineAt')::timestamptz;
    exception when invalid_datetime_format or datetime_field_overflow then
      v_vote_deadline := null;
    end;
    if v_vote_deadline is null or v_vote_deadline <= now() then
      raise exception using errcode = 'PT400', message = 'A final vote needs a future voteDeadlineAt';
    end if;
  end if;

  update public.picks set state = 'ranking' where id = v_id;

  delete from public.ranking_results where pick_id = v_id;
  insert into public.ranking_results (pick_id, place_id, rank, score, finalist)
  select v_id, r.place_id, r.rank, r.score, r.finalist
  from jsonb_to_recordset(v_rows) as r(place_id text, rank integer, score double precision, finalist boolean);

  if v_target = 'completed' then
    update public.picks
    set state = 'completed', winner_place_id = v_winner, decided_at = now(), decided_by = 'clear_winner',
        vote_deadline_at = null
    where id = v_id;
  else
    update public.picks
    set state = 'final_vote', winner_place_id = null, decided_at = null, decided_by = null,
        vote_deadline_at = v_vote_deadline
    where id = v_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. pick_load_for_vote: everything castVote()/closeVote() need to tally.
-- ---------------------------------------------------------------------------
create function public.pick_load_for_vote(p_pick_id text)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_id uuid := private.try_uuid(p_pick_id);
begin
  return (
    select jsonb_build_object(
      'id', p.id,
      'hostId', p.host_id,
      'state', p.state,
      'voteDeadlineAt', p.vote_deadline_at,
      'participantIds', coalesce((
        select jsonb_agg(pp.user_id order by pp.user_id)
        from public.pick_participants pp where pp.pick_id = p.id
      ), '[]'::jsonb),
      'finalists', coalesce((
        select jsonb_agg(jsonb_build_object('placeId', r.place_id, 'rank', r.rank) order by r.rank)
        from public.ranking_results r where r.pick_id = p.id and r.finalist
      ), '[]'::jsonb),
      'ballots', coalesce((
        select jsonb_agg(jsonb_build_object('userId', v.user_id, 'placeId', v.place_id))
        from public.final_votes v where v.pick_id = p.id
      ), '[]'::jsonb)
    )
    from public.picks p where p.id = v_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. pick_cast_vote: one changeable ballot per participant, finalists only.
-- ---------------------------------------------------------------------------
create function public.pick_cast_vote(p_pick_id text, p_user_id uuid, p_place_id text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid := private.try_uuid(p_pick_id);
  v_state public.pick_state;
begin
  select state into v_state from public.picks where id = v_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'Pick not found';
  end if;
  if not exists (select 1 from public.pick_participants where pick_id = v_id and user_id = p_user_id) then
    raise exception using errcode = 'PT403', message = 'Pick access denied';
  end if;
  if v_state <> 'final_vote' then
    raise exception using errcode = 'PT409', message = 'Voting is not open for this Pick';
  end if;
  if not exists (
    select 1 from public.ranking_results where pick_id = v_id and place_id = p_place_id and finalist
  ) then
    raise exception using errcode = 'PT400', message = 'You can only vote for a finalist';
  end if;

  insert into public.final_votes (pick_id, user_id, place_id)
  values (v_id, p_user_id, p_place_id)
  on conflict (pick_id, user_id) do update set place_id = excluded.place_id, created_at = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. pick_close_vote_apply: tally and settle. Silently a no-op if the vote
-- already settled, so whichever caller lost the race (the host, the last
-- voter, or a deadline sweep) does not see a spurious error.
-- ---------------------------------------------------------------------------
-- A tied tally settled by rank order is recorded as 'tie_break' (the app explains it).
alter table public.picks drop constraint picks_decided_by_check;
alter table public.picks add constraint picks_decided_by_check
  check (decided_by in ('clear_winner', 'vote', 'tie_break'));

create function public.pick_close_vote_apply(p_pick_id text, p_winner_place_id text, p_decided_by text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid := private.try_uuid(p_pick_id);
  v_state public.pick_state;
begin
  if p_decided_by is null or p_decided_by not in ('vote', 'tie_break') then
    raise exception using errcode = 'PT400', message = 'decided_by must be vote or tie_break';
  end if;
  select state into v_state from public.picks where id = v_id for update;
  if not found or v_state <> 'final_vote' then
    return;
  end if;
  if not exists (
    select 1 from public.ranking_results where pick_id = v_id and place_id = p_winner_place_id and finalist
  ) then
    raise exception using errcode = 'PT400', message = 'Winner must be a finalist';
  end if;
  update public.picks
  set state = 'completed', winner_place_id = p_winner_place_id, decided_at = now(),
      decided_by = p_decided_by
  where id = v_id;
end;
$$;

-- Service role only. Never callable from the app.
revoke all on function public.pick_load_for_close(text) from public, anon, authenticated;
revoke all on function public.pick_close_apply(text, text, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.pick_load_for_vote(text) from public, anon, authenticated;
revoke all on function public.pick_cast_vote(text, uuid, text) from public, anon, authenticated;
revoke all on function public.pick_close_vote_apply(text, text, text) from public, anon, authenticated;
grant execute on function public.pick_load_for_close(text) to service_role;
grant execute on function public.pick_close_apply(text, text, uuid, text, jsonb) to service_role;
grant execute on function public.pick_load_for_vote(text) to service_role;
grant execute on function public.pick_cast_vote(text, uuid, text) to service_role;
grant execute on function public.pick_close_vote_apply(text, text, text) to service_role;
