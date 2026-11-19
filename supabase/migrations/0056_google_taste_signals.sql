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
alter table public.taste_signals add column google boolean not null default false;
create index taste_signals_google_at_idx on public.taste_signals (at) where google;

create or replace view public.learned_taste with (security_invoker=true) as
 select user_id,place_type,
  sum(weight*power(0.5,extract(epoch from latest-at)/(30*86400.0)))::real as score,
  latest as updated_at
 from (select *,max(at) over(partition by user_id,place_type) as latest from public.taste_signals
       where not google or at >= now() - interval '30 days') s
 group by user_id,place_type,latest;

create function private.lock_taste(p_user_id uuid) returns void
language sql volatile set search_path = '' as $$
  select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('wtw-taste:' || p_user_id::text, 0))
$$;

-- Every learning write goes through here. Removing a signal (no type or weight) always
-- applies; adding one is skipped for actions before the user's epoch, and for Google-derived
-- actions older than 30 days. Best effort: any failure skips the signal, never the caller.
create function private.learn_taste_at(p_user_id uuid, p_source uuid, p_type text, p_weight real,
  p_action_at timestamptz, p_google boolean) returns void
language plpgsql security definer set search_path = '' set lock_timeout = '200ms' as $$
begin
  if p_user_id is null or p_source is null then return; end if;
  perform private.lock_taste(p_user_id);
  if p_type is null or p_type !~ '^[a-z_]{1,60}$' or coalesce(p_weight, 0) = 0 then
    delete from public.taste_signals where user_id = p_user_id and source = p_source;
    return;
  end if;
  if p_action_at is null
     or exists (select 1 from private.taste_epochs e
                where e.user_id = p_user_id and e.since >= p_action_at)
     or (p_google and p_action_at < now() - interval '30 days') then
    return;
  end if;
  insert into public.taste_signals (user_id, source, place_type, weight, at, google)
  values (p_user_id, p_source, p_type, greatest(-10, least(10, p_weight)), p_action_at, p_google)
  on conflict (user_id, source) do update set
    place_type = excluded.place_type, weight = excluded.weight, at = excluded.at,
    google = excluded.google;
exception when others then
  null;
end $$;

-- 0047's triggers keep calling learn_taste; it now takes the lock and honors the epoch too.
-- Their action happens in this transaction, so it's dated to its start (now()): a swipe whose
-- transaction began before a concurrent reset is treated as before it.
create or replace function private.learn_taste(p_user_id uuid, p_source uuid, p_type text,
  p_weight real) returns void
language plpgsql security definer set search_path = '' set lock_timeout = '200ms' as $$
begin
  perform private.learn_taste_at(p_user_id, p_source, p_type, p_weight, now(), false);
end $$;

create function public.taste_record_google_signal(p_user_id uuid, p_pick_id text,
  p_place_id text, p_kind text, p_type text) returns void
language plpgsql security definer set search_path = '' set lock_timeout = '200ms' as $$
declare
  v_pick uuid := private.try_uuid(p_pick_id);
  v_weight real;
  v_at timestamptz;
  v_source uuid;
begin
  if v_pick is null or p_user_id is null or p_type is null or p_type !~ '^[a-z_]{1,60}$' then
    return;
  end if;
  -- Lock before reading the action: a newer swipe or vote then commits either before this
  -- read (and is what we record) or after this write (and its own trigger replaces it).
  perform private.lock_taste(p_user_id);
  if not exists (select 1 from public.pick_candidates c
                 where c.pick_id = v_pick and c.place_id = p_place_id
                   and c.snapshot ->> 'provider' = 'google')
     or not exists (select 1 from public.pick_participants
                    where pick_id = v_pick and user_id = p_user_id) then
    return;
  end if;
  if p_kind = 'swipe' then
    select private.swipe_weight(pr.value), pr.updated_at into v_weight, v_at
      from public.preferences pr
      where pr.pick_id = v_pick and pr.place_id = p_place_id and pr.user_id = p_user_id;
    v_source := private.taste_source('swipe', v_pick, p_place_id);
  elsif p_kind = 'vote' then
    select 1, v.created_at into v_weight, v_at from public.final_votes v
      where v.pick_id = v_pick and v.user_id = p_user_id and v.place_id = p_place_id;
    v_source := private.taste_source('vote', v_pick, null);
  elsif p_kind = 'winner' then
    select 2, p.decided_at into v_weight, v_at from public.picks p
      where p.id = v_pick and p.winner_place_id = p_place_id;
    v_source := private.taste_source('winner', v_pick, null);
  else
    return;
  end if;
  if v_weight is null then return; end if;
  perform private.learn_taste_at(p_user_id, v_source, p_type, v_weight, v_at, true);
exception when others then
  null;
end $$;

-- "Reset what WTW learned": under the same lock, clear every signal and move the epoch.
create function public.taste_reset(p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.lock_taste(p_user_id);
  delete from public.taste_signals where user_id = p_user_id;
  insert into private.taste_epochs (user_id, since) values (p_user_id, now())
    on conflict (user_id) do update set since = greatest(private.taste_epochs.since, excluded.since);
end $$;

-- Runs on every sweep (placeCacheStore.ts), like purge_google_coordinates.
create function public.purge_google_taste(p_cutoff timestamptz) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_removed integer;
begin
  delete from public.taste_signals where google and at < p_cutoff;
  get diagnostics v_removed = row_count;
  return v_removed;
end $$;

revoke all on function private.lock_taste(uuid),
  private.learn_taste_at(uuid, uuid, text, real, timestamptz, boolean)
  from public, anon, authenticated;
revoke all on function public.taste_record_google_signal(uuid, text, text, text, text),
  public.taste_reset(uuid), public.purge_google_taste(timestamptz)
  from public, anon, authenticated;
grant execute on function public.taste_record_google_signal(uuid, text, text, text, text),
  public.taste_reset(uuid), public.purge_google_taste(timestamptz) to service_role;
