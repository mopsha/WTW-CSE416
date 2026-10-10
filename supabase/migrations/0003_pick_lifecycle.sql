-- Pick lifecycle RPCs for the "api" Edge Function (Alan). Week 2.
-- Contract: supabase/functions/_shared/api/lifecycle.ts.
--
-- Same discipline as 0002_heartbeat_rpcs.sql: SECURITY INVOKER, executable only
-- by service_role, SQLSTATE PT400 / PT403 / PT404 / PT409 for expected errors,
-- a row lock (FOR UPDATE) before any read-then-write, and canTransition's
-- rules re-checked here even though the TypeScript layer already checked them.

alter table public.picks
  add column pool_size integer not null default 20 check (pool_size between 10 and 30);
comment on column public.picks.pool_size is 'How many candidates start/refresh should pull from the pool builder.';

-- ---------------------------------------------------------------------------
-- 1. pick_create: draft Pick + host as its first participant, one transaction.
-- ---------------------------------------------------------------------------
create function public.pick_create(
  p_host_id uuid, p_category text, p_center_lat double precision, p_center_lng double precision,
  p_radius_m integer, p_pool_size integer, p_deadline_at timestamptz, p_close_threshold integer
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.picks
    (host_id, category, center_lat, center_lng, radius_m, pool_size, deadline_at, close_threshold)
  values
    (p_host_id, p_category, p_center_lat, p_center_lng, p_radius_m, p_pool_size, p_deadline_at, p_close_threshold)
  returning id into v_id;

  insert into public.pick_participants (pick_id, user_id) values (v_id, p_host_id);

  return jsonb_build_object('id', v_id);
exception
  when check_violation or not_null_violation or foreign_key_violation then
    raise exception using errcode = 'PT400', message = 'Invalid Pick input';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. pick_load: one coherent snapshot for the lifecycle routes (richer than
-- heartbeat_load_pick: full candidate snapshots, pool settings, my answers).
-- ---------------------------------------------------------------------------
create function public.pick_load(p_pick_id text, p_user_id uuid)
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
      select 1 from public.pick_participants pp where pp.pick_id = p.id and pp.user_id = p_user_id
    ),
    jsonb_build_object(
      'id', p.id,
      'hostId', p.host_id,
      'state', p.state,
      'category', p.category,
      'center', jsonb_build_object('lat', p.center_lat, 'lng', p.center_lng),
      'radiusM', p.radius_m,
      'poolSize', p.pool_size,
      'deadlineAt', p.deadline_at,
      'closeThreshold', p.close_threshold,
      'winnerPlaceId', p.winner_place_id,
      'decidedAt', p.decided_at,
      'decidedBy', p.decided_by,
      'participantIds', coalesce((
        select jsonb_agg(pp.user_id order by pp.joined_at, pp.user_id)
        from public.pick_participants pp where pp.pick_id = p.id
      ), '[]'::jsonb),
      'candidates', coalesce((
        select jsonb_agg(jsonb_build_object('placeId', c.place_id, 'snapshot', c.snapshot) order by c.place_id)
        from public.pick_candidates c where c.pick_id = p.id
      ), '[]'::jsonb),
      'hasAnswers', exists (select 1 from public.preferences pr where pr.pick_id = p.id),
      'myAnswers', coalesce((
        select jsonb_object_agg(pr.place_id, pr.value)
        from public.preferences pr where pr.pick_id = p.id and pr.user_id = p_user_id
      ), '{}'::jsonb),
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
-- 3. pick_start: draft -> swiping. Freezes the built pool as pick_candidates
-- (and upserts public.places from the same snapshots, until Josh's
-- place_cache/Google adapter lands and populates places itself).
-- ---------------------------------------------------------------------------
create function public.pick_start(p_pick_id text, p_user_id uuid, p_candidates jsonb)
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
  if v_participants < 2 then
    raise exception using errcode = 'PT409', message = 'A Pick needs at least 2 participants to start';
  end if;
  if jsonb_typeof(p_candidates) is distinct from 'array' or jsonb_array_length(p_candidates) = 0 then
    raise exception using errcode = 'PT400', message = 'At least one candidate is required to start';
  end if;

  insert into public.places (id, name, category, lat, lng, raw)
  select c.place_id, coalesce(c.snapshot ->> 'name', c.place_id), v_pick.category,
         (c.snapshot ->> 'lat')::double precision, (c.snapshot ->> 'lng')::double precision, c.snapshot
  from jsonb_to_recordset(p_candidates) as c(place_id text, snapshot jsonb)
  on conflict (id) do update set
    name = excluded.name, lat = excluded.lat, lng = excluded.lng, raw = excluded.raw, updated_at = now();

  insert into public.pick_candidates (pick_id, place_id, snapshot)
  select v_id, c.place_id, c.snapshot
  from jsonb_to_recordset(p_candidates) as c(place_id text, snapshot jsonb);

  update public.picks set state = 'swiping' where id = v_id;
exception
  when check_violation or not_null_violation then
    raise exception using errcode = 'PT400', message = 'Invalid candidate data';
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. pick_refresh: replace the candidate pool. Deleting pick_candidates
-- cascades to preferences, which is how a refresh "resets everyone's
-- answers" once swiping has started (the confirm gate lives in the API).
-- ---------------------------------------------------------------------------
create function public.pick_refresh(p_pick_id text, p_user_id uuid, p_candidates jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid := private.try_uuid(p_pick_id);
  v_pick public.picks%rowtype;
begin
  select * into v_pick from public.picks where id = v_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'Pick not found';
  end if;
  if v_pick.host_id <> p_user_id then
    raise exception using errcode = 'PT403', message = 'Only the host can refresh this Pick';
  end if;
  if v_pick.state not in ('draft', 'swiping') then
    raise exception using errcode = 'PT409', message = 'Pick must be draft or swiping to refresh';
  end if;
  if jsonb_typeof(p_candidates) is distinct from 'array' or jsonb_array_length(p_candidates) = 0 then
    raise exception using errcode = 'PT400', message = 'At least one candidate is required to refresh';
  end if;

  insert into public.places (id, name, category, lat, lng, raw)
  select c.place_id, coalesce(c.snapshot ->> 'name', c.place_id), v_pick.category,
         (c.snapshot ->> 'lat')::double precision, (c.snapshot ->> 'lng')::double precision, c.snapshot
  from jsonb_to_recordset(p_candidates) as c(place_id text, snapshot jsonb)
  on conflict (id) do update set
    name = excluded.name, lat = excluded.lat, lng = excluded.lng, raw = excluded.raw, updated_at = now();

  delete from public.pick_candidates where pick_id = v_id;

  insert into public.pick_candidates (pick_id, place_id, snapshot)
  select v_id, c.place_id, c.snapshot
  from jsonb_to_recordset(p_candidates) as c(place_id text, snapshot jsonb);
exception
  when check_violation or not_null_violation then
    raise exception using errcode = 'PT400', message = 'Invalid candidate data';
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. pick_cancel: any unfinished Pick -> canceled, host only (the host-only
-- HTTP route; a system/stale-pick sweep is not in scope yet).
-- ---------------------------------------------------------------------------
create function public.pick_cancel(p_pick_id text, p_user_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid := private.try_uuid(p_pick_id);
  v_pick public.picks%rowtype;
begin
  select * into v_pick from public.picks where id = v_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'Pick not found';
  end if;
  if v_pick.host_id <> p_user_id then
    raise exception using errcode = 'PT403', message = 'Only the host can cancel this Pick';
  end if;
  if v_pick.state in ('completed', 'canceled') then
    raise exception using errcode = 'PT409', message = 'This Pick can no longer be canceled';
  end if;
  update public.picks set state = 'canceled' where id = v_id;
end;
$$;

-- Service role only. Never callable from the app.
revoke all on function public.pick_create(uuid, text, double precision, double precision, integer, integer, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.pick_load(text, uuid) from public, anon, authenticated;
revoke all on function public.pick_start(text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.pick_refresh(text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.pick_cancel(text, uuid) from public, anon, authenticated;
grant execute on function public.pick_create(uuid, text, double precision, double precision, integer, integer, timestamptz, integer) to service_role;
grant execute on function public.pick_load(text, uuid) to service_role;
grant execute on function public.pick_start(text, uuid, jsonb) to service_role;
grant execute on function public.pick_refresh(text, uuid, jsonb) to service_role;
grant execute on function public.pick_cancel(text, uuid) to service_role;
