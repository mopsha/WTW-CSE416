-- Account deletion (Razin, M4). Contract: DELETE /me in docs/api-integration.md,
-- supabase/functions/_shared/api/account.ts, supabase/functions/api/accountStore.ts.
--
-- The API deletes the auth.users row with the service role (Auth admin API). Postgres
-- cascades that to public.profiles, and a BEFORE DELETE trigger on profiles applies the
-- rules below in the same transaction, so a deletion is all or nothing, and deleting a
-- user from the dashboard follows the same rules.
--
-- Rules:
--   * Everything of theirs goes: profile, answers, ballots, RSVPs, friendships, saved
--     places, notifications, push tokens, hang posts, groups they own (the groups' Picks
--     stay, unlabeled), and content they shared with others.
--   * Picks they hosted that nobody else is in are deleted.
--   * Picks they hosted that are unfinished are canceled, so everyone else sees them as
--     canceled ("The host deleted their account."). Completed (and already canceled)
--     ones are kept. Either way host_id becomes null: the app shows "Deleted user".
--   * Other people's Picks are never deleted. They only lose this person's participant
--     row and answers; their results stay.
--   * A Pick without a host is read-only (see picks_hostless_guard below).
--
-- Tables from open PRs (friendships 0008, notifications/push_tokens 0009, saved places
-- 0010, groups 0012, RSVPs/outcomes 0013, custom plans 0015, hang posts 0016) may land
-- before or after this file. Nothing here names them statically: the trigger checks
-- to_regclass / the catalog and uses dynamic SQL, as 0013 does for groups. Tables that
-- only reference profiles with ON DELETE CASCADE need nothing beyond the cascade.

-- ---------------------------------------------------------------------------
-- 1. The known bug: deleting an Auth user who is in any Pick failed with "Database error
-- deleting user". The cascade into pick_participants fires 0002's version-bump trigger,
-- which ran as the caller (supabase_auth_admin) and has no rights on public.picks
-- (42501). It only bumps a counter, so run it as its owner.
-- ---------------------------------------------------------------------------
alter function private.bump_parent_pick_version() security definer;

-- ---------------------------------------------------------------------------
-- 2. A Pick can outlive its host.
-- ---------------------------------------------------------------------------
alter table public.picks alter column host_id drop not null;
alter table public.picks drop constraint picks_host_id_fkey;
-- SET NULL is a backstop: the trigger below has already handled every hosted Pick.
alter table public.picks
  add constraint picks_host_id_fkey
  foreign key (host_id) references public.profiles (id) on delete set null;
alter table public.picks
  add constraint picks_hostless_is_over check (host_id is not null or state in ('completed', 'canceled'));
comment on column public.picks.host_id is 'Null once the host deleted their account (shown as "Deleted user"); such a Pick is completed or canceled and read-only.';

-- Host checks in the RPCs are written `host_id <> p_user_id`, which is NULL (not true)
-- for a hostless Pick and would let any participant through. Most of those RPCs also
-- require draft/swiping, which picks_hostless_is_over rules out. For the rest (0013's
-- plan time and "Pick again") the database refuses instead:
--   * a hostless Pick may only change bookkeeping columns: version/updated_at (0002
--     triggers) and the FK SET NULL columns group_id (0012) and again_of (0013);
--   * no Pick may be a "Pick again" copy of a hostless one.
-- to_jsonb keeps this independent of which columns exist.
create function private.picks_hostless_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_bookkeeping constant text[] := array['version', 'updated_at', 'group_id', 'again_of'];
  v_again_of uuid := (to_jsonb(new) ->> 'again_of')::uuid;
begin
  if tg_op = 'UPDATE' then
    if old.host_id is null
      and (to_jsonb(new) - c_bookkeeping) is distinct from (to_jsonb(old) - c_bookkeeping) then
      raise exception using errcode = 'PT409', message = 'This Pick''s host deleted their account';
    end if;
    if v_again_of is not distinct from (to_jsonb(old) ->> 'again_of')::uuid then
      return new;
    end if;
  end if;
  if v_again_of is not null
    and exists (select 1 from public.picks where id = v_again_of and host_id is null) then
    raise exception using errcode = 'PT403', message = 'Only the host can pick again';
  end if;
  return new;
end;
$$;
revoke all on function private.picks_hostless_guard() from public, anon, authenticated;

create trigger picks_hostless_guard
  before insert or update on public.picks
  for each row execute function private.picks_hostless_guard();

-- ---------------------------------------------------------------------------
-- 3. Custom plans (0015, PR #27): custom options record their creator in
-- pick_candidates.created_by / places.created_by (ON DELETE CASCADE) and in the JSON
-- they were built from (createdBy). Cascading would delete candidates out of other
-- people's Picks (and fail outright for a winner). Instead the creator is erased and the
-- option kept, so: a null creator is allowed, the FKs become SET NULL, and 0015's
-- "owner is immutable" rule becomes "an owner may be cleared, never reassigned".
-- Only runs if 0015 is applied (it is numbered before this file, so `db reset` always
-- applies it first).
-- ---------------------------------------------------------------------------
do $$
declare
  v_table text;
  v_fk text;
begin
  foreach v_table in array array['pick_candidates', 'places'] loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = v_table and column_name = 'created_by'
    ) then
      continue;
    end if;
    for v_fk in
      select c.conname from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
      where c.conrelid = format('public.%I', v_table)::regclass and c.contype = 'f'
        and a.attname = 'created_by'
    loop
      execute format('alter table public.%I drop constraint %I', v_table, v_fk);
    end loop;
    execute format(
      'alter table public.%I add constraint %I foreign key (created_by) references public.profiles (id) on delete set null',
      v_table, v_table || '_created_by_fkey');
  end loop;

  if to_regclass('public.pick_candidates') is not null and exists (
    select 1 from pg_constraint where conname = 'custom_candidate_creator'
      and conrelid = 'public.pick_candidates'::regclass
  ) then
    alter table public.pick_candidates drop constraint custom_candidate_creator;
    alter table public.pick_candidates add constraint custom_candidate_creator check (source <> 'custom' or
      place_id ~ '^custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
  end if;
  if exists (
    select 1 from pg_constraint where conname = 'custom_place_identity'
      and conrelid = 'public.places'::regclass
  ) then
    alter table public.places drop constraint custom_place_identity;
    alter table public.places add constraint custom_place_identity check (source <> 'custom' or
      id ~ '^custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
  end if;

  if to_regprocedure('private.custom_place_provenance()') is not null then
    -- Same as 0015, except the owner may be cleared (account deletion).
    create or replace function private.custom_place_provenance() returns trigger
    language plpgsql set search_path = '' as $fn$
    begin
     if new.id like 'custom:%' then
       if new.raw->>'provider' is distinct from 'custom' then
         raise exception using errcode = 'PT400', message = 'Custom provenance required';
       end if;
       new.source := 'custom';
       new.created_by := (new.raw->>'createdBy')::uuid;
       if tg_op = 'UPDATE' and old.source = 'custom' and new.created_by is not null
         and new.created_by is distinct from old.created_by then
         raise exception using errcode = 'PT403', message = 'Custom owner is immutable';
       end if;
     end if;
     return new;
    end $fn$;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. The deletion itself.
-- ---------------------------------------------------------------------------
create function private.has_column(p_table text, p_column text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid = to_regclass('public.' || p_table) and attname = p_column
      and attnum > 0 and not attisdropped
  );
$$;
revoke all on function private.has_column(text, text) from public, anon, authenticated;

create function private.profile_before_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_reason constant text := 'The host deleted their account.';
  v_user uuid := old.id;
  v_canceled uuid[];
begin
  -- Same lock as every Pick writer, in a fixed order, before reading their state.
  perform 1 from public.picks where host_id = v_user order by id for update;

  -- Groups they own go; their Picks stay (0012: picks.group_id ON DELETE SET NULL).
  if to_regclass('public.groups') is not null then
    execute 'delete from public.groups where owner_id = $1' using v_user;
  end if;

  -- Hosted Picks nobody else is in: nothing to keep for anyone.
  delete from public.picks p
  where p.host_id = v_user
    and not exists (
      select 1 from public.pick_participants pp where pp.pick_id = p.id and pp.user_id <> v_user
    );

  -- Custom options they typed (0015) record them as creator. Erased while they are still
  -- the host: once host_id is null the Pick is read-only (picks_hostless_guard).
  if private.has_column('picks', 'custom_options') then
    execute $q$
      update public.picks p
      set custom_options = (select coalesce(jsonb_agg(o - 'createdBy'), '[]'::jsonb)
                            from jsonb_array_elements(p.custom_options) o)
      where p.host_id = $1
        and exists (select 1 from jsonb_array_elements(p.custom_options) o where o ? 'createdBy')
    $q$ using v_user;
  end if;

  -- Hosted unfinished Picks: canceled, so everyone else sees that. One statement, since
  -- the Pick is read-only from the moment host_id is null.
  execute format(
    $q$
      with canceled as (
        update public.picks set state = 'canceled', host_id = null %s
        where host_id = $1 and state not in ('completed', 'canceled')
        returning id
      )
      select coalesce(array_agg(id), '{}') from canceled
    $q$,
    case when private.has_column('picks', 'cancel_reason') then ', cancel_reason = $2' else '' end)
  into v_canceled using v_user, c_reason;

  -- An inbox entry for everyone else (0009). Push needs the API, which this transaction
  -- can't call; the app finds the Pick canceled on its next read either way.
  if cardinality(v_canceled) > 0 and to_regclass('public.notifications') is not null then
    execute $q$
      insert into public.notifications (user_id, type, pick_id, payload)
      select pp.user_id, 'pick_canceled', pp.pick_id, jsonb_build_object('reason', $1::text)
      from public.pick_participants pp
      where pp.pick_id = any ($2) and pp.user_id <> $3
      on conflict do nothing
    $q$ using c_reason, v_canceled, v_user;
  end if;

  -- Hosted Picks that are over (completed, or canceled earlier): kept for everyone else.
  update public.picks set host_id = null where host_id = v_user;

  -- Options they created in anyone's Pick (0015): kept, creator erased.
  if private.has_column('pick_candidates', 'created_by') then
    execute $q$
      update public.pick_candidates set snapshot = snapshot - 'createdBy', created_by = null
      where created_by = $1 or snapshot ->> 'createdBy' = $1::text
    $q$ using v_user;
  end if;
  if private.has_column('places', 'created_by') then
    -- Nobody's Pick shows it any more: delete it outright.
    execute $q$
      delete from public.places pl
      where pl.created_by = $1
        and not exists (select 1 from public.pick_candidates c where c.place_id = pl.id)
    $q$ using v_user;
    execute $q$
      update public.places set raw = raw - 'createdBy', created_by = null
      where created_by = $1
    $q$ using v_user;
  end if;

  -- Push tokens (0009): this account's devices get nothing more.
  if to_regclass('public.push_tokens') is not null then
    execute 'delete from public.push_tokens where user_id = $1' using v_user;
  end if;
  -- Per-user rate-limit counters (0010) are keyed by user id, without an FK.
  if to_regclass('public.rate_limit_counters') is not null then
    execute $q$delete from public.rate_limit_counters where scope = 'create' and subject = $1::text$q$
      using v_user;
  end if;

  -- Everything else references profiles ON DELETE CASCADE: participant rows (and with
  -- them answers and ballots), friendships, notifications, saved places, RSVPs,
  -- outcomes, hang posts and responses, group memberships.
  return old;
end;
$$;
revoke all on function private.profile_before_delete() from public, anon, authenticated;

create trigger profile_before_delete
  before delete on public.profiles
  for each row execute function private.profile_before_delete();
