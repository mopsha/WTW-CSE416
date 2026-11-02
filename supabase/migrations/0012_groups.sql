-- Groups: reusable groups for repeat Picks (Razin, M4, FR-04 / FR-05).
-- Contract: supabase/functions/api/groupsStore.ts, docs/api-integration.md ("Groups").
--
-- Same discipline as 0006: clients only SELECT (through RLS, members only);
-- every write is an RPC that is SECURITY INVOKER, executable only by
-- service_role, locks the row it changes, and raises SQLSTATE PT4xx for
-- expected errors. The HINT says which one, so the API can tell "not the
-- owner" from "not your friend" without parsing messages.
--
-- Rules:
--   * The owner creates, renames and deletes the group, and adds and removes
--     members. Only the owner's accepted friends can be added.
--   * Anyone but the owner can leave. The owner deletes the group instead.
--   * Starting a Pick for a group copies who is in the group *now* into
--     pick_participants. Removing or leaving later never touches past Picks,
--     so people keep their results, and are simply not added to new ones.
--
-- Friends come from public.friendships (0008_friendships.sql, PR #24). Until
-- that migration is applied, private.are_friends() finds no table and answers
-- false, so nobody can be added (fail closed) and nothing else breaks. Every
-- reference to friendships is in PL/pgSQL, which Postgres does not resolve
-- until the statement runs, so this file applies with or without 0008.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  -- The API trims; the check keeps the database honest either way.
  name text not null check (char_length(name) between 1 and 50 and name = btrim(name)),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.groups is 'Reusable groups for repeat Picks. Readable by members only; written only by the server.';
create index groups_owner_id_idx on public.groups (owner_id);

create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  constraint group_members_group_user_key unique (group_id, user_id)
);
comment on table public.group_members is 'Who is in each group. The owner has a row with role owner.';
-- Exactly one owner row per group (group_create writes it).
create unique index group_members_one_owner on public.group_members (group_id) where role = 'owner';
create index group_members_user_id_idx on public.group_members (user_id);

-- Which group a Pick was started for. Deleting the group keeps the Pick and
-- its results; only the label goes.
alter table public.picks
  add column group_id uuid references public.groups (id) on delete set null;
create index picks_group_id_idx on public.picks (group_id) where group_id is not null;

-- ---------------------------------------------------------------------------
-- RLS helpers (security definer so policies do not recurse through RLS)
-- ---------------------------------------------------------------------------
create function private.is_group_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.group_members
    where group_id = p_group_id and user_id = (select auth.uid())
  );
$$;
revoke all on function private.is_group_member(uuid) from public, anon;
grant execute on function private.is_group_member(uuid) to authenticated, service_role;

create function private.shares_group_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members me
    join public.group_members them on them.group_id = me.group_id
    where me.user_id = (select auth.uid()) and them.user_id = p_user_id
  );
$$;
revoke all on function private.shares_group_with(uuid) from public, anon;
grant execute on function private.shares_group_with(uuid) to authenticated, service_role;

-- Accepted friends, either direction. False while 0008 is not applied.
create function private.are_friends(p_a uuid, p_b uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if to_regclass('public.friendships') is null then
    return false;
  end if;
  return exists (
    select 1 from public.friendships
    where status = 'accepted'
      and ((requester_id = p_a and addressee_id = p_b)
        or (requester_id = p_b and addressee_id = p_a))
  );
end;
$$;
revoke all on function private.are_friends(uuid, uuid) from public, anon, authenticated;
grant execute on function private.are_friends(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- RLS: members only. No write policies, no write grants.
-- ---------------------------------------------------------------------------
alter table public.groups enable row level security;
alter table public.group_members enable row level security;

create policy "groups: members" on public.groups
  for select to authenticated
  using (private.is_group_member(id));
create policy "group_members: members of the same group" on public.group_members
  for select to authenticated
  using (private.is_group_member(group_id));
-- Group members can read each other's display name (the member list). The
-- 0001 policy (self and co-participants) stays; policies are OR'ed.
create policy "profiles: members of my groups" on public.profiles
  for select to authenticated
  using (private.shares_group_with(id));

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
revoke all on table public.groups, public.group_members from anon, authenticated;
grant select on table public.groups, public.group_members to authenticated;
grant all on table public.groups, public.group_members to service_role;

-- ---------------------------------------------------------------------------
-- Shared checks for the RPCs below. Non-members get PT404, never PT403, so
-- the API does not confirm that a group they are not in exists.
-- ---------------------------------------------------------------------------
create function private.lock_group_as_member(p_group_id uuid, p_user_id uuid)
returns public.groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group public.groups;
begin
  select * into v_group from public.groups where id = p_group_id for update;
  if not found or not exists (
    select 1 from public.group_members where group_id = p_group_id and user_id = p_user_id
  ) then
    raise exception using errcode = 'PT404', message = 'Group not found', hint = 'group_not_found';
  end if;
  return v_group;
end;
$$;
revoke all on function private.lock_group_as_member(uuid, uuid) from public, anon, authenticated;
grant execute on function private.lock_group_as_member(uuid, uuid) to service_role;

create function private.lock_group_as_owner(p_group_id uuid, p_user_id uuid)
returns public.groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group public.groups := private.lock_group_as_member(p_group_id, p_user_id);
begin
  if v_group.owner_id <> p_user_id then
    raise exception using errcode = 'PT403', message = 'Only the group owner can do this', hint = 'not_owner';
  end if;
  return v_group;
end;
$$;
revoke all on function private.lock_group_as_owner(uuid, uuid) from public, anon, authenticated;
grant execute on function private.lock_group_as_owner(uuid, uuid) to service_role;

-- Every id must be an accepted friend of p_user_id. All or nothing.
create function private.require_friends(p_user_id uuid, p_user_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from unnest(p_user_ids) as u(id)
    where u.id <> p_user_id and not private.are_friends(p_user_id, u.id)
  ) then
    raise exception using errcode = 'PT403', message = 'You can only add your friends', hint = 'not_friends';
  end if;
end;
$$;
revoke all on function private.require_friends(uuid, uuid[]) from public, anon, authenticated;
grant execute on function private.require_friends(uuid, uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- group_create: the caller owns the new group and is its first member.
-- ---------------------------------------------------------------------------
create function public.group_create(p_user_id uuid, p_name text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_group public.groups;
begin
  insert into public.groups (name, owner_id) values (p_name, p_user_id)
  returning * into v_group;
  insert into public.group_members (group_id, user_id, role) values (v_group.id, p_user_id, 'owner');
  return jsonb_build_object('id', v_group.id, 'name', v_group.name, 'ownerId', v_group.owner_id);
exception
  when check_violation or not_null_violation then
    raise exception using errcode = 'PT400', message = 'Group names are 1 to 50 characters', hint = 'invalid_name';
  when foreign_key_violation then
    raise exception using errcode = 'PT403', message = 'No profile for this user', hint = 'no_profile';
end;
$$;

-- ---------------------------------------------------------------------------
-- group_rename / group_delete: owner only.
-- ---------------------------------------------------------------------------
create function public.group_rename(p_user_id uuid, p_group_id uuid, p_name text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform private.lock_group_as_owner(p_group_id, p_user_id);
  update public.groups set name = p_name, updated_at = now() where id = p_group_id;
exception
  when check_violation or not_null_violation then
    raise exception using errcode = 'PT400', message = 'Group names are 1 to 50 characters', hint = 'invalid_name';
end;
$$;

-- Picks started for the group keep their participants and results
-- (picks.group_id is set to null by the foreign key).
create function public.group_delete(p_user_id uuid, p_group_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform private.lock_group_as_owner(p_group_id, p_user_id);
  delete from public.groups where id = p_group_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- group_add_members: owner only; each person must be the owner's accepted
-- friend. People already in the group are skipped. Returns how many were added.
-- ---------------------------------------------------------------------------
create function public.group_add_members(p_user_id uuid, p_group_id uuid, p_user_ids uuid[])
returns integer
language plpgsql
set search_path = ''
as $$
declare
  c_max_members constant integer := 25;
  v_added integer;
begin
  perform private.lock_group_as_owner(p_group_id, p_user_id);
  perform private.require_friends(p_user_id, p_user_ids);

  insert into public.group_members (group_id, user_id)
  select p_group_id, u.id from (select distinct unnest(p_user_ids) as id) u
  on conflict do nothing;
  get diagnostics v_added = row_count;

  if (select count(*) from public.group_members where group_id = p_group_id) > c_max_members then
    raise exception using errcode = 'PT409', message = 'A group can have up to 25 people', hint = 'group_full';
  end if;
  return v_added;
exception
  when foreign_key_violation then
    raise exception using errcode = 'PT404', message = 'No profile for this user', hint = 'user_not_found';
end;
$$;

-- ---------------------------------------------------------------------------
-- group_remove_member: owner only, never the owner. Idempotent. Past Picks
-- are not touched.
-- ---------------------------------------------------------------------------
create function public.group_remove_member(p_user_id uuid, p_group_id uuid, p_member_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform private.lock_group_as_owner(p_group_id, p_user_id);
  if p_member_id = p_user_id then
    raise exception using errcode = 'PT409', message = 'The owner cannot be removed; delete the group instead', hint = 'owner_cannot_leave';
  end if;
  delete from public.group_members where group_id = p_group_id and user_id = p_member_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- group_leave: any member but the owner.
-- ---------------------------------------------------------------------------
create function public.group_leave(p_user_id uuid, p_group_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_group public.groups := private.lock_group_as_member(p_group_id, p_user_id);
begin
  if v_group.owner_id = p_user_id then
    raise exception using errcode = 'PT409', message = 'The owner cannot leave; delete the group instead', hint = 'owner_cannot_leave';
  end if;
  delete from public.group_members where group_id = p_group_id and user_id = p_user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- pick_add_group: right after POST /picks creates a draft, add everyone who
-- is in the group now and label the Pick with it. Host only, draft only, and
-- the host must be a member. Locks the Pick (same discipline as every Pick
-- writer; the participant inserts bump picks.version through 0002), then the
-- group, so a concurrent remove either lands before (not added) or after
-- (already a participant, keeps this Pick). Returns how many were added.
-- ---------------------------------------------------------------------------
create function public.pick_add_group(p_pick_id uuid, p_user_id uuid, p_group_id uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_pick public.picks;
  v_added integer;
begin
  select * into v_pick from public.picks where id = p_pick_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'Pick not found', hint = 'pick_not_found';
  end if;
  if v_pick.host_id <> p_user_id then
    raise exception using errcode = 'PT403', message = 'Only the host can do this', hint = 'not_host';
  end if;
  if v_pick.state <> 'draft' or (v_pick.group_id is not null and v_pick.group_id <> p_group_id) then
    raise exception using errcode = 'PT409', message = 'This Pick can no longer change groups', hint = 'pick_closed';
  end if;
  perform private.lock_group_as_member(p_group_id, p_user_id);

  update public.picks set group_id = p_group_id, updated_at = now() where id = p_pick_id;
  insert into public.pick_participants (pick_id, user_id)
  select p_pick_id, gm.user_id from public.group_members gm where gm.group_id = p_group_id
  on conflict do nothing;
  get diagnostics v_added = row_count;
  return v_added;
end;
$$;

-- ---------------------------------------------------------------------------
-- pick_invite: the host adds individual friends while the Pick is draft or
-- swiping (the same window as joining by code, 0006). All or nothing.
-- Returns how many were added; people already in it are skipped.
-- ---------------------------------------------------------------------------
create function public.pick_invite(p_pick_id uuid, p_user_id uuid, p_user_ids uuid[])
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_pick public.picks;
  v_added integer;
begin
  select * into v_pick from public.picks where id = p_pick_id for update;
  if not found or not exists (
    select 1 from public.pick_participants where pick_id = p_pick_id and user_id = p_user_id
  ) then
    raise exception using errcode = 'PT404', message = 'Pick not found', hint = 'pick_not_found';
  end if;
  if v_pick.host_id <> p_user_id then
    raise exception using errcode = 'PT403', message = 'Only the host can do this', hint = 'not_host';
  end if;
  if v_pick.state not in ('draft', 'swiping') then
    raise exception using errcode = 'PT409', message = 'This Pick is no longer accepting people', hint = 'pick_closed';
  end if;
  perform private.require_friends(p_user_id, p_user_ids);

  insert into public.pick_participants (pick_id, user_id)
  select p_pick_id, u.id from (select distinct unnest(p_user_ids) as id) u
  on conflict do nothing;
  get diagnostics v_added = row_count;
  return v_added;
exception
  when foreign_key_violation then
    raise exception using errcode = 'PT404', message = 'No profile for this user', hint = 'user_not_found';
end;
$$;

-- ---------------------------------------------------------------------------
-- Service role only.
-- ---------------------------------------------------------------------------
revoke all on function public.group_create(uuid, text) from public, anon, authenticated;
revoke all on function public.group_rename(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.group_delete(uuid, uuid) from public, anon, authenticated;
revoke all on function public.group_add_members(uuid, uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.group_remove_member(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.group_leave(uuid, uuid) from public, anon, authenticated;
revoke all on function public.pick_add_group(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.pick_invite(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.group_create(uuid, text) to service_role;
grant execute on function public.group_rename(uuid, uuid, text) to service_role;
grant execute on function public.group_delete(uuid, uuid) to service_role;
grant execute on function public.group_add_members(uuid, uuid, uuid[]) to service_role;
grant execute on function public.group_remove_member(uuid, uuid, uuid) to service_role;
grant execute on function public.group_leave(uuid, uuid) to service_role;
grant execute on function public.pick_add_group(uuid, uuid, uuid) to service_role;
grant execute on function public.pick_invite(uuid, uuid, uuid[]) to service_role;
