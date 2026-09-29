-- Heartbeat RPCs for the "api" Edge Function (Razin, contract by Josh).
-- Contract: docs/api-integration.md, types: supabase/functions/_shared/api/heartbeat.ts.
--
-- These run as the caller (security invoker) and are executable ONLY by service_role.
-- Expected errors use SQLSTATE PT400 / PT403 / PT404 / PT409, which the API maps
-- to HTTP 400 / 403 / 404 / 409.

-- ---------------------------------------------------------------------------
-- Version: changes on every ranking-input change (participants, candidates,
-- preferences, and any change to the Pick row itself, including state).
-- Maintained by triggers so every writer follows the same discipline.
-- ---------------------------------------------------------------------------
alter table public.picks add column version bigint not null default 1;
comment on column public.picks.version is 'Bumped by triggers on any change to the Pick or its ranking inputs. Opaque to clients.';

-- Ranking needs coordinates from the fixed snapshot, never from live place data.
alter table public.pick_candidates
  add constraint pick_candidates_snapshot_coords check (
    jsonb_typeof(snapshot -> 'lat') = 'number' and jsonb_typeof(snapshot -> 'lng') = 'number'
  );

create function private.picks_bump_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;

create trigger picks_bump_version
  before update on public.picks
  for each row execute function private.picks_bump_version();

create function private.bump_parent_pick_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.picks set version = version + 1
  where id = case when tg_op = 'DELETE' then old.pick_id else new.pick_id end;
  if tg_op = 'UPDATE' and new.pick_id is distinct from old.pick_id then
    update public.picks set version = version + 1 where id = old.pick_id;
  end if;
  return null;
end;
$$;

create trigger pick_participants_bump_version
  after insert or update or delete on public.pick_participants
  for each row execute function private.bump_parent_pick_version();
create trigger pick_candidates_bump_version
  after insert or update or delete on public.pick_candidates
  for each row execute function private.bump_parent_pick_version();
create trigger preferences_bump_version
  after insert or update or delete on public.preferences
  for each row execute function private.bump_parent_pick_version();

revoke all on function private.picks_bump_version() from public, anon, authenticated;
revoke all on function private.bump_parent_pick_version() from public, anon, authenticated;

-- Pick ids arrive from the URL; a malformed id is "not found", not a 500.
create function private.try_uuid(p text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;
revoke all on function private.try_uuid(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. heartbeat_load_pick: one coherent PickSnapshot (single statement = single snapshot).
-- ---------------------------------------------------------------------------
create function public.heartbeat_load_pick(p_pick_id text, p_user_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_id uuid := private.try_uuid(p_pick_id);
  v_is_participant boolean;
  v_snapshot jsonb;
begin
  select
    exists (
      select 1 from public.pick_participants pp
      where pp.pick_id = p.id and pp.user_id = p_user_id
    ),
    jsonb_build_object(
      'id', p.id,
      'hostId', p.host_id,
      'state', p.state,
      'center', jsonb_build_object('lat', p.center_lat, 'lng', p.center_lng),
      'participantIds', coalesce((
        select jsonb_agg(pp.user_id order by pp.joined_at, pp.user_id)
        from public.pick_participants pp where pp.pick_id = p.id
      ), '[]'::jsonb),
      'candidates', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'placeId', c.place_id,
                 'lat', (c.snapshot ->> 'lat')::double precision,
                 'lng', (c.snapshot ->> 'lng')::double precision)
               order by c.place_id)
        from public.pick_candidates c where c.pick_id = p.id
      ), '[]'::jsonb),
      'preferences', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'userId', pr.user_id, 'placeId', pr.place_id, 'value', pr.value)
               order by pr.user_id, pr.place_id)
        from public.preferences pr where pr.pick_id = p.id
      ), '[]'::jsonb),
      'version', p.version::text
    )
  into v_is_participant, v_snapshot
  from public.picks p
  where p.id = v_id;

  if v_snapshot is null then
    return null;
  end if;
  if not v_is_participant then
    raise exception using errcode = 'PT403', message = 'Pick access denied';
  end if;
  return v_snapshot;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. heartbeat_upsert_swipe
-- ---------------------------------------------------------------------------
create function public.heartbeat_upsert_swipe(
  p_pick_id text, p_user_id uuid, p_place_id text, p_value integer
)
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
  if not exists (
    select 1 from public.pick_participants where pick_id = v_id and user_id = p_user_id
  ) then
    raise exception using errcode = 'PT403', message = 'Pick access denied';
  end if;
  if v_state <> 'swiping' then
    raise exception using errcode = 'PT409', message = 'Pick must be swiping';
  end if;
  if p_value is null or p_value not between 0 and 2 then
    raise exception using errcode = 'PT400', message = 'Invalid preference value';
  end if;
  if not exists (
    select 1 from public.pick_candidates where pick_id = v_id and place_id = p_place_id
  ) then
    raise exception using errcode = 'PT400', message = 'Invalid candidate';
  end if;

  insert into public.preferences (pick_id, place_id, user_id, value)
  values (v_id, p_place_id, p_user_id, p_value::smallint)
  on conflict (pick_id, place_id, user_id)
  do update set value = excluded.value, updated_at = now();
  -- Version advances via preferences_bump_version in this same transaction.
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. heartbeat_save_ranking
-- p_ranking: { rows: [{place_id, rank, score, finalist}], state: 'completed'|'final_vote',
--              winnerPlaceId: text|null }
-- ---------------------------------------------------------------------------
create function public.heartbeat_save_ranking(
  p_pick_id text, p_user_id uuid, p_version text, p_ranking jsonb
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
  v_rows jsonb := p_ranking -> 'rows';
  v_candidates integer;
  v_valid boolean;
begin
  select * into v_pick from public.picks where id = v_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'Pick not found';
  end if;
  if not exists (
    select 1 from public.pick_participants where pick_id = v_id and user_id = p_user_id
  ) or v_pick.host_id <> p_user_id then
    raise exception using errcode = 'PT403', message = 'Pick access denied';
  end if;
  if v_pick.state <> 'swiping' or p_version is distinct from v_pick.version::text then
    raise exception using errcode = 'PT409', message = 'Pick changed; reload before trying again';
  end if;

  -- Validate the whole payload before writing anything.
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
    and (v_target <> 'completed' or (
      v_winner is not null
      and bool_or(r.place_id = v_winner and r.rank = 1)
    ))
    and (v_target <> 'final_vote' or (v_winner is null and bool_or(r.finalist)))
  into v_valid
  from jsonb_to_recordset(v_rows) as r(place_id text, rank integer, score double precision, finalist boolean)
  left join public.pick_candidates c on c.pick_id = v_id and c.place_id = r.place_id;

  if v_candidates = 0 or not coalesce(v_valid, false) then
    raise exception using errcode = 'PT400', message = 'Ranking does not match the candidate pool';
  end if;

  update public.picks set state = 'ranking' where id = v_id;

  delete from public.ranking_results where pick_id = v_id;
  insert into public.ranking_results (pick_id, place_id, rank, score, finalist)
  select v_id, r.place_id, r.rank, r.score, r.finalist
  from jsonb_to_recordset(v_rows) as r(place_id text, rank integer, score double precision, finalist boolean);

  if v_target = 'completed' then
    update public.picks
    set state = 'completed', winner_place_id = v_winner, decided_at = now(), decided_by = 'clear_winner'
    where id = v_id;
  else
    update public.picks
    set state = 'final_vote', winner_place_id = null, decided_at = null, decided_by = null
    where id = v_id;
  end if;
end;
$$;

-- Service role only. Never callable from the app.
revoke all on function public.heartbeat_load_pick(text, uuid) from public, anon, authenticated;
revoke all on function public.heartbeat_upsert_swipe(text, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.heartbeat_save_ranking(text, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.heartbeat_load_pick(text, uuid) to service_role;
grant execute on function public.heartbeat_upsert_swipe(text, uuid, text, integer) to service_role;
grant execute on function public.heartbeat_save_ranking(text, uuid, text, jsonb) to service_role;
grant execute on function private.try_uuid(text) to service_role;
