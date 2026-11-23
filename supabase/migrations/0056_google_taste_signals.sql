-- Learning from Google places (Alan). Spec: docs/taste-onboarding.md#learning.
-- 0047's triggers learn from a candidate's stored tasteType, which Google places never have
-- (0049 strips it). Here the API records Google signals with the type it has live, via
-- taste_record_google_signal. Only a per-user "leaned toward <type>" signal is stored, keyed
-- by a hashed source like every other signal, and Google-derived ones expire after 30 days.
--
-- Guarantees (all learning paths, triggers included):
-- * One lock per user (wtw-taste:<user>) orders every learning write and every reset, so a
--   reset can't race a write, and a recorder reads the canonical swipe/vote after any newer
--   change has committed.
-- * A per-user epoch (taste_epochs.since): no signal for an action older than the user's last
--   reset, however late the request arrives. Existing users start at this migration, so a
--   reset made before 0056 (which left no record) can't be undone by old Picks either.
-- * Domain triggers capture the action in its own transaction, under the canonical row's write
--   lock. If anything in the way is busy or fails, the whole captured action is queued instead
--   (an insert with no foreign keys or unique rows to wait on), so learning doesn't fail or hold
--   up a swipe, vote, close or refresh and the new choice isn't lost. The sweep applies it,
--   even if the Pick has since been deleted.
-- * Every captured action takes a sequence number while it holds that write lock, so an older
--   queued action never replaces a newer saved one.
-- * The weight and action time come from the saved swipe, ballot or winner, never the caller;
--   the API proves the type with a server signature (tasteSignals.ts) before calling this.
-- Numbered 0056: 0052 (on main) and 0053–0055 (pick-flow and Hang PRs) come first.

create table private.taste_epochs (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  since timestamptz not null
);
revoke all on table private.taste_epochs from public, anon, authenticated;
insert into private.taste_epochs (user_id, since) select id, now() from public.profiles;

-- Google-derived signals: kept 30 days at most (purge_google_taste, and the view below).
alter table public.taste_signals
  add column google boolean not null default false,
  add column source_revision uuid;
create index taste_signals_google_at_idx on public.taste_signals (at) where google;

create or replace view public.learned_taste with (security_invoker=true) as
 select user_id,place_type,
  sum(weight*power(0.5,extract(epoch from latest-at)/(30*86400.0)))::real as score,
  latest as updated_at
 from (select *,max(at) over(partition by user_id,place_type) as latest from public.taste_signals
       where not google or at >= now() - interval '30 days') s
 group by user_id,place_type,latest;

-- Orders captured actions, saved or queued. The swipe, ballot or Pick row serializes a
-- source's writers, so a later action always draws a higher number (never set a cache here).
create sequence private.taste_seq;

-- One durable row per domain source: its latest applied action. Revisions are equality
-- tokens, never ordered; seq orders.
-- No Pick FK: deletion preserves the last committed action as learning history.
-- Google rows retain only the revision and action time, never the live type.
create table private.taste_source_state (
  user_id uuid not null references public.profiles(id) on delete cascade,
  source uuid not null,
  seq bigint not null,
  revision uuid not null,
  action_at timestamptz not null,
  place_type text,
  weight real,
  google boolean not null,
  check ((google and place_type is null and weight is null) or (not google and weight is not null)),
  primary key (user_id, source)
);

-- Queued work. With a revision, the row is a captured action that couldn't be saved (no
-- profiles FK on purpose: taking one waits on profile saves and account deletion). Without
-- one, it only asks for the source to be projected again.
create table private.taste_pending (
  id bigint primary key default nextval('private.taste_seq'),
  user_id uuid not null,
  source uuid,
  at timestamptz not null default clock_timestamp(),
  revision uuid,
  action_at timestamptz,
  place_type text,
  weight real,
  google boolean,
  check (case when revision is null
    then num_nonnulls(action_at, place_type, weight, google) = 0
    else source is not null and action_at is not null and google is not null
      and ((google and place_type is null and weight is null) or (not google and weight is not null))
    end)
);
create index taste_pending_source_idx on private.taste_pending (user_id, source);
-- The cursor rotates through bounded ID batches, including past entries for busy users.
create table private.taste_sweep_cursor (
  singleton boolean primary key default true check (singleton),
  last_id bigint not null default 0,
  end_id bigint not null default 0
);
insert into private.taste_sweep_cursor default values;
revoke all on table private.taste_source_state, private.taste_pending, private.taste_sweep_cursor
  from public, anon, authenticated;
revoke all on sequence private.taste_seq from public, anon, authenticated;

create function private.lock_taste(p_user_id uuid) returns void
language sql volatile set search_path = '' as $$
  select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('wtw-taste:' || p_user_id::text, 0))
$$;

-- Refresh serializes with deferred projections and the Google recorder independently
-- of the user lock. Domain writers already serialize with refresh on the Pick row.
create function private.taste_refresh_lock_key(p_source uuid) returns bigint
language sql immutable strict set search_path = '' as $$
  select pg_catalog.hashtextextended('wtw-taste-refresh:' || p_source::text, 0)
$$;

-- Project one snapshot of the affected source states.
-- A concurrent domain write either applies its own state after this projection or
-- commits a new queue ID. Pick deletion neither changes the state nor takes this lock.
create function private.apply_taste_sources(p_user_id uuid, p_sources uuid[]) returns void
language sql volatile set search_path = '' set lock_timeout = '200ms' as $$
  with states as materialized (
    select s.*, s.action_at > coalesce(
      (select since from private.taste_epochs where user_id = p_user_id), '-infinity') as eligible
    from private.taste_source_state s
    where s.user_id = p_user_id and s.source = any(p_sources)
  ), removed as (
    delete from public.taste_signals t using states s
    where t.user_id = s.user_id and t.source = s.source
      and case when not s.google and (s.place_type is null or s.weight = 0) then true
               when s.google or not s.eligible then t.source_revision is distinct from s.revision
               else false end
  )
  insert into public.taste_signals as t (user_id, source, place_type, weight, at, google, source_revision)
  select user_id, source, place_type, weight, action_at, false, revision
  from states where eligible and not google and place_type is not null and weight <> 0
  on conflict (user_id, source) do update set
    place_type = excluded.place_type, weight = excluded.weight, at = excluded.at,
    google = false, source_revision = excluded.source_revision
  where (t.place_type, t.weight, t.at, t.google, t.source_revision) is distinct from
        (excluded.place_type, excluded.weight, excluded.at, false, excluded.source_revision)
$$;

-- Save one action for these sources and project it, or queue it whole. Waits are bounded and
-- nothing outside the handler can wait on another row. p_refresh takes the refresh locks
-- instead of the user lock (a refresh covers every participant, so it must not hold theirs).
create function private.capture_taste(p_user_id uuid, p_sources uuid[], p_action_at timestamptz,
  p_place_type text, p_weight real, p_google boolean, p_refresh boolean) returns void
language plpgsql security definer set search_path = '' set lock_timeout = '200ms' as $$
begin
  begin
    if p_refresh then
      perform pg_catalog.pg_advisory_xact_lock(private.taste_refresh_lock_key(source))
      from unnest(p_sources) as sources(source);
    else
      perform private.lock_taste(p_user_id);
    end if;
    insert into private.taste_source_state as s
      (user_id, source, seq, revision, action_at, place_type, weight, google)
    select p_user_id, source, nextval('private.taste_seq'), gen_random_uuid(), p_action_at,
      p_place_type, p_weight, p_google
    from unnest(p_sources) as sources(source)
    on conflict (user_id, source) do update set
      seq = excluded.seq, revision = excluded.revision, action_at = excluded.action_at,
      place_type = excluded.place_type, weight = excluded.weight, google = excluded.google
    where s.seq < excluded.seq;
    perform private.apply_taste_sources(p_user_id, p_sources);
  exception when others then
    insert into private.taste_pending
      (user_id, source, revision, action_at, place_type, weight, google)
    select p_user_id, source, gen_random_uuid(), p_action_at, p_place_type, p_weight, p_google
    from unnest(p_sources) as sources(source);
  end;
end $$;

create function private.save_taste_source(p_user_id uuid, p_source uuid, p_pick_id uuid,
  p_place_id text, p_weight real, p_action_at timestamptz) returns void
language sql volatile security definer set search_path = '' as $$
  select private.capture_taste(p_user_id, array[p_source], p_action_at,
    case when not c.google and c.place_type ~ '^[a-z_]{1,60}$' then c.place_type end,
    case when not c.google then greatest(-10, least(10, p_weight)) end, c.google, false)
  from (
    select coalesce(snapshot ->> 'provider' = 'google', false) as google,
      snapshot ->> 'tasteType' as place_type
    from public.pick_candidates where pick_id = p_pick_id and place_id = p_place_id
  ) c
$$;

-- Override 0047's refresh cleanup. Lock the Pick before collecting actions so a
-- concurrent swipe or ballot cannot commit between collection and deck replacement.
-- A tombstone, saved or queued, outranks any queued work for the old deck. If it's queued
-- because the refresh lock was busy, the sweep still removes whatever its holder recorded.
create or replace function private.unlearn_pick_swipes(p_pick_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_pick uuid := private.try_uuid(p_pick_id);
  v_user uuid;
  v_sources uuid[];
begin
  perform 1 from public.picks where id = v_pick for update;
  if not found then return; end if;

  for v_user, v_sources in
    select user_id, array_agg(source order by source)
    from (
      select user_id, private.taste_source('swipe', v_pick, place_id) as source
      from public.preferences where pick_id = v_pick
      union all
      select user_id, private.taste_source('vote', v_pick, null)
      from public.final_votes where pick_id = v_pick
    ) actions
    group by user_id order by user_id
  loop
    perform private.capture_taste(v_user, v_sources, clock_timestamp(), null, 0, false, true);
  end loop;
end $$;

-- Keep the original action time on an identical retry so it cannot cross a taste
-- reset. Preserve swipe version bumps and the existing Pick locking and validation.
create or replace function public.heartbeat_upsert_swipe(
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
  do update set value = excluded.value,
    updated_at = case when preferences.value is distinct from excluded.value
                      then excluded.updated_at else preferences.updated_at end;
  -- Version advances via preferences_bump_version in this same transaction.
end;
$$;

create or replace function public.pick_cast_vote(p_pick_id text, p_user_id uuid, p_place_id text)
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
  on conflict (pick_id, user_id) do update set place_id = excluded.place_id,
    created_at = case when final_votes.place_id is distinct from excluded.place_id
                      then excluded.created_at else final_votes.created_at end;
end;
$$;

-- Keep 0047's logical action boundaries. These AFTER triggers run while the domain
-- row is write-locked, so even an older transaction updates state in actual write order.
create or replace function private.learn_from_swipe() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.value = old.value then return new; end if;
  perform private.save_taste_source(new.user_id, private.taste_source('swipe', new.pick_id, new.place_id),
    new.pick_id, new.place_id, private.swipe_weight(new.value), new.updated_at);
  return new;
end $$;

create or replace function private.learn_from_vote() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.place_id = old.place_id then return new; end if;
  perform private.save_taste_source(new.user_id, private.taste_source('vote', new.pick_id, null),
    new.pick_id, new.place_id, 1, new.created_at);
  return new;
end $$;

create or replace function private.learn_from_winner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.save_taste_source(pp.user_id, private.taste_source('winner', new.id, null),
    new.id, new.winner_place_id, 2, coalesce(new.decided_at, now()))
  from (select user_id from public.pick_participants where pick_id = new.id order by user_id) pp;
  return new;
end $$;

drop function private.learn_taste(uuid, uuid, text, real);

-- Resolve the exact saved action and its eligibility without retaining Google's live type.
create function private.google_taste_action(p_user_id uuid, p_pick_id uuid, p_place_id text, p_kind text)
returns table (weight real, action_at timestamptz)
language sql stable set search_path = '' as $$
  select a.weight, a.action_at
  from (
    select private.swipe_weight(pr.value), pr.updated_at
      from public.preferences pr where p_kind = 'swipe'
       and pr.pick_id = p_pick_id and pr.place_id = p_place_id and pr.user_id = p_user_id
    union all
    select 1::real, v.created_at
      from public.final_votes v where p_kind = 'vote'
       and v.pick_id = p_pick_id and v.place_id = p_place_id and v.user_id = p_user_id
    union all
    select 2::real, p.decided_at
      from public.picks p where p_kind = 'winner'
       and p.id = p_pick_id and p.winner_place_id = p_place_id
  ) a (weight, action_at)
  where a.action_at >= now() - interval '30 days'
    and not exists (select 1 from private.taste_epochs e
                    where e.user_id = p_user_id and e.since >= a.action_at)
    and exists (select 1 from public.pick_candidates c
                where c.pick_id = p_pick_id and c.place_id = p_place_id
                  and c.snapshot ->> 'provider' = 'google')
    and exists (select 1 from public.pick_participants pp
                where pp.pick_id = p_pick_id and pp.user_id = p_user_id)
$$;

create function public.taste_record_google_signal(p_user_id uuid, p_pick_id text,
  p_place_id text, p_kind text, p_type text) returns void
language plpgsql security definer set search_path = '' set lock_timeout = '200ms' as $$
declare
  v_pick uuid := private.try_uuid(p_pick_id);
  v_weight real;
  v_at timestamptz;
  v_source uuid;
  v_revision uuid;
begin
  if v_pick is null or p_user_id is null or p_type is null or p_type !~ '^[a-z_]{1,60}$' then
    return;
  end if;
  v_source := case p_kind when 'swipe' then private.taste_source('swipe', v_pick, p_place_id)
                          when 'vote' then private.taste_source('vote', v_pick, null)
                          when 'winner' then private.taste_source('winner', v_pick, null) end;
  if v_source is null then return; end if;
  -- Read canonical evidence under the lock, including any reset or action that just committed.
  perform private.lock_taste(p_user_id);
  if p_kind in ('swipe', 'vote') and not
     pg_catalog.pg_try_advisory_xact_lock_shared(private.taste_refresh_lock_key(v_source)) then
    return;
  end if;
  -- Swipe and ballot retries preserve the original action time. Pre-migration
  -- actions may have no source revision, but must still pass the epoch check.
  -- A queued action's revision counts too, so the sweep keeps this signal when it applies it.
  select a.weight, a.action_at, s.revision into v_weight, v_at, v_revision
    from private.google_taste_action(p_user_id, v_pick, p_place_id, p_kind) a
    left join lateral (
      select r.revision, r.google from (
        select seq, revision, google from private.taste_source_state
         where user_id = p_user_id and source = v_source
        union all
        select id, revision, google from private.taste_pending
         where user_id = p_user_id and source = v_source and revision is not null
      ) r order by r.seq desc limit 1
    ) s on s.google;
  if v_weight is null then return; end if;
  if v_weight = 0 then
    delete from public.taste_signals where user_id = p_user_id and source = v_source;
  else
    insert into public.taste_signals (user_id, source, place_type, weight, at, google, source_revision)
    values (p_user_id, v_source, p_type, v_weight, v_at, true, v_revision)
    on conflict (user_id, source) do update set
      place_type = excluded.place_type, weight = excluded.weight, at = excluded.at,
      google = true, source_revision = excluded.source_revision;
  end if;
exception when others then
  begin
    -- Recorder retries never authorize source repair. Any change to the saved action
    -- has its own durable state and is queued by the domain trigger if needed.
    insert into private.taste_pending (user_id)
    select p_user_id where v_source is not null and exists (
      select 1 from private.google_taste_action(p_user_id, v_pick, p_place_id, p_kind));
  exception when others then
    null;
  end;
end $$;

-- "Reset what WTW learned": under the same lock, clear every signal and move the epoch.
-- The epoch is read after the lock (clock_timestamp, not now()): actions that committed while
-- the reset waited are cleared too, so a later rebuild can't bring them back.
create function public.taste_reset(p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.lock_taste(p_user_id);
  delete from public.taste_signals where user_id = p_user_id;
  insert into private.taste_epochs (user_id, since) values (p_user_id, clock_timestamp())
    on conflict (user_id) do update set since = greatest(private.taste_epochs.since, excluded.since);
end $$;

-- Apply, project and claim in one subtransaction. Source-less recorder entries carry no
-- authoritative change or Google type. Only domain entries can repair a source.
create function private.taste_reconcile(p_user_id uuid, p_ids bigint[]) returns void
language plpgsql security definer set search_path = '' set lock_timeout = '200ms' as $$
declare
  v_sources uuid[];
begin
  if not pg_catalog.pg_try_advisory_xact_lock(
       pg_catalog.hashtextextended('wtw-taste:' || p_user_id::text, 0)) then
    return;
  end if;
  -- A deleted account's queued actions are just dropped.
  if exists (select 1 from public.profiles where id = p_user_id) then
    select array_agg(distinct source) into v_sources from private.taste_pending
     where user_id = p_user_id and id = any(p_ids) and source is not null;
  end if;
  if v_sources is not null then
    -- Refresh can hold a source while replacing the deck. Roll back on contention so the
    -- next projection reads the committed tombstone or new action.
    if exists (
      select 1 from unnest(v_sources) as sources(source)
      where not pg_catalog.pg_try_advisory_xact_lock_shared(private.taste_refresh_lock_key(source))
    ) then
      raise lock_not_available;
    end if;
    -- The newest queued action per source, even one outside this batch, so an older answer
    -- never shows between sweeps. seq drops any that a saved action has overtaken.
    insert into private.taste_source_state as s
      (user_id, source, seq, revision, action_at, place_type, weight, google)
    select distinct on (source) user_id, source, id, revision, action_at, place_type, weight, google
    from private.taste_pending
    where user_id = p_user_id and source = any(v_sources) and revision is not null
    order by source, id desc
    on conflict (user_id, source) do update set
      seq = excluded.seq, revision = excluded.revision, action_at = excluded.action_at,
      place_type = excluded.place_type, weight = excluded.weight, google = excluded.google
    where s.seq < excluded.seq;
    perform private.apply_taste_sources(p_user_id, v_sources);
  end if;
  delete from private.taste_pending where user_id = p_user_id and id = any(p_ids);
end $$;

-- Rotate through at most 200 queue rows using the primary key. Skipped rows stay
-- queued and are revisited after wrapping. Only one sweep advances the cursor at a time.
create function public.purge_google_taste(p_cutoff timestamptz) returns integer
language plpgsql security definer set search_path = '' set lock_timeout = '200ms' as $$
declare
  v_removed integer := 0;
  v_cursor bigint;
  v_end bigint;
  v_user uuid;
  v_ids bigint[];
  v_last bigint;
  v_next bigint;
begin
  begin
    lock table public.taste_signals in row exclusive mode nowait;
    with expired as materialized (
      select user_id, source from public.taste_signals
      where google and at < p_cutoff
      order by at limit 500 for update skip locked
    )
    delete from public.taste_signals t using expired e
    where t.user_id = e.user_id and t.source = e.source;
    get diagnostics v_removed = row_count;
    if exists (select 1 from public.taste_signals
               where google and at < least(p_cutoff, now() - interval '30 days')) then
      raise warning 'Google taste signals past retention remain for the next sweep';
    end if;
  exception when lock_not_available then
    raise warning 'Google taste retention cleanup deferred because the signals table is locked';
  end;

  select last_id, end_id into v_cursor, v_end from private.taste_sweep_cursor for update skip locked;
  if not found then return v_removed; end if;
  if not exists (select 1 from private.taste_pending where id > v_cursor and id <= v_end) then
    v_cursor := 0;
    -- A fixed high-water mark lets us wrap even while new work keeps arriving.
    select coalesce(max(id), 0) into v_end from private.taste_pending;
  end if;
  v_next := v_cursor;

  for v_user, v_ids, v_last in
    select user_id, array_agg(id), max(id)
    from (
      select id, user_id from private.taste_pending
       where id > v_cursor and id <= v_end order by id limit 200
    ) batch
    group by user_id order by min(id)
  loop
    v_next := greatest(v_next, v_last);
    begin
      perform private.taste_reconcile(v_user, v_ids);
    exception when others then
      raise warning 'Taste source reconciliation deferred (SQLSTATE %)', sqlstate;
    end;
  end loop;

  update private.taste_sweep_cursor set last_id = v_next, end_id = v_end;
  return v_removed;
end $$;

revoke all on function private.lock_taste(uuid),
  private.taste_refresh_lock_key(uuid),
  private.apply_taste_sources(uuid, uuid[]),
  private.capture_taste(uuid, uuid[], timestamptz, text, real, boolean, boolean),
  private.save_taste_source(uuid, uuid, uuid, text, real, timestamptz),
  private.taste_reconcile(uuid, bigint[]),
  private.google_taste_action(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.taste_record_google_signal(uuid, text, text, text, text),
  public.taste_reset(uuid), public.purge_google_taste(timestamptz)
  from public, anon, authenticated;
grant execute on function public.taste_record_google_signal(uuid, text, text, text, text),
  public.taste_reset(uuid), public.purge_google_taste(timestamptz) to service_role;
