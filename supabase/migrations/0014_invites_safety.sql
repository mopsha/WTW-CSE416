-- Invites and safety (Razin, M4): join-code brute-force limits, a participant cap, a
-- "lock lobby" flag, blocking, reports, per-user rate limits and invite links.
-- Contract: docs/api-integration.md ("Invites and safety"), supabase/functions/_shared/api/
-- safety.ts, invites.ts, friendRequests.ts, and supabase/functions/api/safetyStore.ts.
--
-- Same discipline as 0002–0006: clients only SELECT (their own blocks and invite links);
-- every write is a SECURITY INVOKER RPC executable only by service_role, raising SQLSTATE
-- PT4xx for expected errors (PT429 = rate limited).
--
-- Joining (by code or by link) never says *why* it failed: an unknown, expired, closed,
-- locked or full Pick, or a host who blocked you, all look the same, so codes can't be
-- probed. Those RPCs return a status instead of raising, so the failed attempt they record
-- is committed: 10 failed joins per user per rolling hour, then PT429-style "rate_limited".
--
-- Friendships (0008, PR #24) and groups (0012, PR #30) may not exist. Rules that touch them
-- check to_regclass and use dynamic SQL, as 0013 and 0017 do. Their block triggers are
-- attached by private.attach_block_guards(), which runs at the end of this file; a database
-- that gets 0008 or 0012 after this file must run it once more (docs/api-integration.md).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
-- Failed joins only (code or link), for the brute-force limit. Server-only.
create table public.join_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  via text not null check (via in ('code', 'link')),
  created_at timestamptz not null default now()
);
comment on table public.join_attempts is 'Failed joins by code or invite link. No client access; read by the join RPCs.';
create index join_attempts_user_created_idx on public.join_attempts (user_id, created_at desc);

-- One row per counted action, for per-user daily limits. Server-only.
create table public.rate_limit_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  action text not null check (action in ('friend_request', 'report', 'invite_create')),
  created_at timestamptz not null default now()
);
comment on table public.rate_limit_events is 'Counted actions for per-user rate limits (private.rate_take). No client access.';
create index rate_limit_events_user_action_idx on public.rate_limit_events (user_id, action, created_at desc);

-- The host can stop new people joining by code or link (their own invites still work).
alter table public.picks add column lobby_locked boolean not null default false;
comment on column public.picks.lobby_locked is 'Host switch: when true, pick_join and invite links admit nobody new.';

create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_not_self check (blocker_id <> blocked_id)
);
comment on table public.blocks is 'Who I blocked. Readable by the blocker only (the blocked person is never told).';
create index blocks_blocked_id_idx on public.blocks (blocked_id);

-- Moderation queue. Nobody but the service role reads it; the target has no FK, so a
-- report outlives what it is about.
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  target_kind text not null check (target_kind in ('user', 'pick', 'group')),
  target_id uuid not null,
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  created_at timestamptz not null default now()
);
comment on table public.reports is 'Reports of people, Picks and groups. No client access.';
create index reports_target_idx on public.reports (target_kind, target_id);
create index reports_reporter_created_idx on public.reports (reporter_id, created_at desc);

-- Invite links: wtw://i/TOKEN. 128 random bits, base64url without padding (22 chars).
-- target_id has no FK because it is a Pick or a group; a link to something deleted just
-- stops working.
create table public.invite_links (
  token text primary key check (token ~ '^[A-Za-z0-9_-]{22}$'),
  kind text not null check (kind in ('pick', 'group')),
  target_id uuid not null,
  created_by uuid not null references public.profiles (id) on delete cascade,
  expires_at timestamptz not null default now() + interval '7 days',
  max_uses integer check (max_uses between 1 and 100),
  uses integer not null default 0 check (uses >= 0 and (max_uses is null or uses <= max_uses)),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
comment on table public.invite_links is 'Invite links for a Pick or a group. Readable by their creator; accepted only through invite_accept.';
create index invite_links_target_idx on public.invite_links (kind, target_id);
create index invite_links_created_by_idx on public.invite_links (created_by, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------
alter table public.join_attempts enable row level security;
alter table public.rate_limit_events enable row level security;
alter table public.blocks enable row level security;
alter table public.reports enable row level security;
alter table public.invite_links enable row level security;

create policy "blocks: only mine" on public.blocks
  for select to authenticated
  using (blocker_id = (select auth.uid()));
create policy "invite_links: only mine" on public.invite_links
  for select to authenticated
  using (created_by = (select auth.uid()));

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
revoke all on table
  public.join_attempts, public.rate_limit_events, public.blocks, public.reports, public.invite_links
from anon, authenticated;
grant select on table public.blocks, public.invite_links to authenticated;
grant all on table
  public.join_attempts, public.rate_limit_events, public.blocks, public.reports, public.invite_links
to service_role;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create function private.pick_participant_cap()
returns integer
language sql
immutable
set search_path = ''
as $$ select 30 $$;

-- Either person blocked the other.
create function private.is_blocked_between(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.blocks
    where (blocker_id = p_a and blocked_id = p_b) or (blocker_id = p_b and blocked_id = p_a)
  );
$$;

-- Takes one unit of a per-user limit, or returns false. The advisory lock serializes one
-- user's concurrent calls so two requests can't both see "19 of 20".
create function private.rate_take(p_user_id uuid, p_action text)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_limit integer;
  v_window interval := interval '1 day';
begin
  v_limit := case p_action
    when 'friend_request' then 20
    when 'report' then 10
    when 'invite_create' then 20
  end;
  if v_limit is null then
    raise exception 'Unknown rate limit %', p_action;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('wtw-rate:' || p_action || ':' || p_user_id, 0));
  if (select count(*) from public.rate_limit_events
      where user_id = p_user_id and action = p_action and created_at > now() - v_window) >= v_limit then
    return false;
  end if;
  insert into public.rate_limit_events (user_id, action) values (p_user_id, p_action);
  return true;
end;
$$;

-- Failed joins in the last hour, under the same per-user lock the join RPCs take.
create function private.join_rate_limited(p_user_id uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('wtw-join:' || p_user_id, 0));
  return (select count(*) from public.join_attempts
          where user_id = p_user_id and created_at > now() - interval '1 hour') >= 10;
end;
$$;

-- 128 bits from the CSPRNG, base64url, no padding.
create function private.new_invite_token()
returns text
language sql
volatile
set search_path = ''
as $$
  select translate(rtrim(encode(extensions.gen_random_bytes(16), 'base64'), '='), '+/', '-_');
$$;

revoke all on function private.pick_participant_cap() from public, anon, authenticated;
revoke all on function private.is_blocked_between(uuid, uuid) from public, anon, authenticated;
revoke all on function private.rate_take(uuid, text) from public, anon, authenticated;
revoke all on function private.join_rate_limited(uuid) from public, anon, authenticated;
revoke all on function private.new_invite_token() from public, anon, authenticated;
grant execute on function private.pick_participant_cap() to service_role;
grant execute on function private.is_blocked_between(uuid, uuid) to service_role;
grant execute on function private.rate_take(uuid, text) to service_role;
grant execute on function private.join_rate_limited(uuid) to service_role;
grant execute on function private.new_invite_token() to service_role;

-- ---------------------------------------------------------------------------
-- Every way into a Pick (join code, invite link, 0012's host invites and group adds, 0013's
-- "Pick again") inserts a pick_participants row, so the rules live on that table:
--   * nobody joins a Pick whose host blocked them, or whom they blocked: the row is skipped
--     silently (bulk adds carry on, and a single add reports "0 added", never "blocked");
--   * at most 30 people (PT409, hint pick_full).
-- The join RPCs check both first so they can answer with their usual generic failure.
-- ---------------------------------------------------------------------------
create function private.pick_participants_safety()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host uuid;
begin
  select host_id into v_host from public.picks where id = new.pick_id;
  if v_host is not null and v_host <> new.user_id and private.is_blocked_between(v_host, new.user_id) then
    return null;
  end if;
  if (select count(*) from public.pick_participants where pick_id = new.pick_id)
     >= private.pick_participant_cap() then
    raise exception using errcode = 'PT409', message = 'This Pick is full', hint = 'pick_full';
  end if;
  return new;
end;
$$;
revoke all on function private.pick_participants_safety() from public, anon, authenticated;

create trigger pick_participants_safety
  before insert on public.pick_participants
  for each row execute function private.pick_participants_safety();

-- ---------------------------------------------------------------------------
-- Friendships (0008) and group members (0012): skip rows between blocked people. For a
-- group the other person is its owner, the only one who adds members.
-- ---------------------------------------------------------------------------
create function private.friendships_block_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.is_blocked_between(new.requester_id, new.addressee_id) then
    return null;
  end if;
  return new;
end;
$$;

create function private.group_members_block_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  execute 'select owner_id from public.groups where id = $1' into v_owner using new.group_id;
  if v_owner is not null and v_owner <> new.user_id and private.is_blocked_between(v_owner, new.user_id) then
    return null;
  end if;
  return new;
end;
$$;
revoke all on function private.friendships_block_guard() from public, anon, authenticated;
revoke all on function private.group_members_block_guard() from public, anon, authenticated;

-- Idempotent. Attaches the guards to whichever of the two tables exist.
create function private.attach_block_guards()
returns text[]
language plpgsql
set search_path = ''
as $$
declare
  v_attached text[] := '{}';
begin
  if to_regclass('public.friendships') is not null and not exists (
    select 1 from pg_trigger where tgname = 'friendships_block_guard'
      and tgrelid = to_regclass('public.friendships')
  ) then
    create trigger friendships_block_guard
      before insert on public.friendships
      for each row execute function private.friendships_block_guard();
    v_attached := array_append(v_attached, 'friendships');
  end if;
  if to_regclass('public.group_members') is not null and not exists (
    select 1 from pg_trigger where tgname = 'group_members_block_guard'
      and tgrelid = to_regclass('public.group_members')
  ) then
    create trigger group_members_block_guard
      before insert on public.group_members
      for each row execute function private.group_members_block_guard();
    v_attached := array_append(v_attached, 'group_members');
  end if;
  return v_attached;
end;
$$;
revoke all on function private.attach_block_guards() from public, anon, authenticated, service_role;

select private.attach_block_guards();

-- ---------------------------------------------------------------------------
-- pick_join: replaces 0006's. Returns { ok: true, pickId } or { ok: false, reason } with
-- reason 'invalid' (every kind of "no") or 'rate_limited'. Someone already in the Pick
-- always gets ok, in any state, and it never counts as a failure.
-- ---------------------------------------------------------------------------
drop function public.pick_join(text, uuid);

create function public.pick_join(p_code text, p_user_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  -- Codes are typed by people: ignore case and spaces.
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
  v_pick public.picks%rowtype;
  v_inserted integer;
begin
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception using errcode = 'PT403', message = 'No profile for this user';
  end if;
  if private.join_rate_limited(p_user_id) then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  -- Same lock as every other Pick writer.
  select p.* into v_pick
  from public.pick_join_codes j join public.picks p on p.id = j.pick_id
  where j.code = v_code and j.expires_at > now()
  for update of p;

  if found and exists (
    select 1 from public.pick_participants where pick_id = v_pick.id and user_id = p_user_id
  ) then
    return jsonb_build_object('ok', true, 'pickId', v_pick.id);
  end if;

  if found and v_pick.state in ('draft', 'swiping') and not v_pick.lobby_locked
     and (select count(*) from public.pick_participants where pick_id = v_pick.id)
         < private.pick_participant_cap()
     and not (v_pick.host_id is not null and private.is_blocked_between(v_pick.host_id, p_user_id)) then
    insert into public.pick_participants (pick_id, user_id) values (v_pick.id, p_user_id)
    on conflict do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted = 1 then
      return jsonb_build_object('ok', true, 'pickId', v_pick.id);
    end if;
  end if;

  insert into public.join_attempts (user_id, via) values (p_user_id, 'code');
  return jsonb_build_object('ok', false, 'reason', 'invalid');
end;
$$;
revoke all on function public.pick_join(text, uuid) from public, anon, authenticated;
grant execute on function public.pick_join(text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- pick_set_lobby_locked: host only, while people can still join (draft or swiping).
-- ---------------------------------------------------------------------------
create function public.pick_set_lobby_locked(p_pick_id text, p_user_id uuid, p_locked boolean)
returns boolean
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
  if v_pick.host_id is distinct from p_user_id then
    raise exception using errcode = 'PT403', message = 'Only the host can lock the lobby';
  end if;
  if v_pick.state not in ('draft', 'swiping') then
    raise exception using errcode = 'PT409', message = 'This Pick is no longer accepting people';
  end if;
  if p_locked is null then
    raise exception using errcode = 'PT400', message = 'locked must be true or false';
  end if;
  update public.picks set lobby_locked = p_locked where id = v_pick.id;
  return p_locked;
end;
$$;

-- ---------------------------------------------------------------------------
-- Blocking. Blocking ends any friendship or request either way. It doesn't remove anyone
-- from Picks or groups they already share.
-- ---------------------------------------------------------------------------
create function public.block_user(p_user_id uuid, p_target_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_target_id is null or p_target_id = p_user_id then
    raise exception using errcode = 'PT400', message = 'You cannot block yourself';
  end if;
  if not exists (select 1 from public.profiles where id = p_target_id) then
    raise exception using errcode = 'PT404', message = 'User not found';
  end if;
  insert into public.blocks (blocker_id, blocked_id) values (p_user_id, p_target_id)
  on conflict do nothing;
  if to_regclass('public.friendships') is not null then
    execute 'delete from public.friendships
             where (requester_id = $1 and addressee_id = $2) or (requester_id = $2 and addressee_id = $1)'
      using p_user_id, p_target_id;
  end if;
exception
  when foreign_key_violation then
    raise exception using errcode = 'PT403', message = 'No profile for this user';
end;
$$;

-- Idempotent. The friendship does not come back.
create function public.unblock_user(p_user_id uuid, p_target_id uuid)
returns void
language sql
set search_path = ''
as $$
  delete from public.blocks where blocker_id = p_user_id and blocked_id = p_target_id;
$$;

-- ---------------------------------------------------------------------------
-- Reports: 10 per user per day. You can report a person, or a Pick/group you are in.
-- Anything else is PT404, so a report never confirms that something exists.
-- ---------------------------------------------------------------------------
create function public.report_create(p_user_id uuid, p_kind text, p_target_id uuid, p_reason text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_visible boolean;
  v_id uuid;
begin
  if p_kind is null or p_kind not in ('user', 'pick', 'group') or p_target_id is null
     or char_length(v_reason) not between 1 and 500 then
    raise exception using errcode = 'PT400', message = 'Invalid report';
  end if;
  v_visible := case p_kind
    when 'user' then p_target_id <> p_user_id
      and exists (select 1 from public.profiles where id = p_target_id)
    when 'pick' then exists (
      select 1 from public.pick_participants where pick_id = p_target_id and user_id = p_user_id)
    else false
  end;
  if p_kind = 'group' and to_regclass('public.group_members') is not null then
    execute 'select exists (select 1 from public.group_members where group_id = $1 and user_id = $2)'
      into v_visible using p_target_id, p_user_id;
  end if;
  if not v_visible then
    raise exception using errcode = 'PT404', message = 'Nothing to report here';
  end if;
  if not private.rate_take(p_user_id, 'report') then
    raise exception using errcode = 'PT429', message = 'Too many reports today';
  end if;
  insert into public.reports (reporter_id, target_kind, target_id, reason)
  values (p_user_id, p_kind, p_target_id, v_reason)
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- rate_limit_take: one unit of a per-user limit for limits enforced in the API (friend
-- requests: 20 per day, called before 0008's friend_request). True if allowed.
-- ---------------------------------------------------------------------------
create function public.rate_limit_take(p_user_id uuid, p_action text)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  if p_action is distinct from 'friend_request' then
    raise exception using errcode = 'PT400', message = 'Unknown rate limit';
  end if;
  return private.rate_take(p_user_id, p_action);
exception
  when foreign_key_violation then
    raise exception using errcode = 'PT403', message = 'No profile for this user';
end;
$$;

-- ---------------------------------------------------------------------------
-- Invite links
-- ---------------------------------------------------------------------------
-- A Pick's host (while people can join) or a group's owner. 20 links per user per day.
create function public.invite_create(p_user_id uuid, p_kind text, p_target_id uuid, p_max_uses integer)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_pick public.picks%rowtype;
  v_owner uuid;
  v_link public.invite_links;
begin
  if p_kind is null or p_kind not in ('pick', 'group') or p_target_id is null
     or (p_max_uses is not null and p_max_uses not between 1 and 100) then
    raise exception using errcode = 'PT400', message = 'Invalid invite';
  end if;

  if p_kind = 'pick' then
    select * into v_pick from public.picks where id = p_target_id for update;
    if not found or not exists (
      select 1 from public.pick_participants where pick_id = p_target_id and user_id = p_user_id
    ) then
      raise exception using errcode = 'PT404', message = 'Pick not found';
    end if;
    if v_pick.host_id is distinct from p_user_id then
      raise exception using errcode = 'PT403', message = 'Only the host can make invite links';
    end if;
    if v_pick.state not in ('draft', 'swiping') then
      raise exception using errcode = 'PT409', message = 'This Pick is no longer accepting people';
    end if;
  else
    if to_regclass('public.group_members') is null then
      raise exception using errcode = 'PT404', message = 'Group not found';
    end if;
    execute 'select g.owner_id from public.groups g
             where g.id = $1 and exists (select 1 from public.group_members m
                                         where m.group_id = g.id and m.user_id = $2)
             for update of g'
      into v_owner using p_target_id, p_user_id;
    if v_owner is null then
      raise exception using errcode = 'PT404', message = 'Group not found';
    end if;
    if v_owner <> p_user_id then
      raise exception using errcode = 'PT403', message = 'Only the group owner can make invite links';
    end if;
  end if;

  if not private.rate_take(p_user_id, 'invite_create') then
    raise exception using errcode = 'PT429', message = 'Too many invite links today';
  end if;

  -- A collision is a 2^-128 event; retry anyway rather than fail.
  for attempt in 1..3 loop
    begin
      insert into public.invite_links (token, kind, target_id, created_by, max_uses)
      values (private.new_invite_token(), p_kind, p_target_id, p_user_id, p_max_uses)
      returning * into v_link;
      exit;
    exception when unique_violation then
      -- Try another token.
    end;
  end loop;
  if v_link.token is null then
    raise exception 'Could not issue an invite token';
  end if;
  return jsonb_build_object(
    'token', v_link.token, 'kind', v_link.kind, 'targetId', v_link.target_id,
    'expiresAt', v_link.expires_at, 'maxUses', v_link.max_uses);
end;
$$;

-- Returns { ok: true, kind, targetId } or { ok: false, reason: 'invalid' | 'rate_limited' }.
-- Same rules as pick_join: every "no" looks the same and counts toward the same 10 failed
-- joins per hour. Someone already in the Pick or group gets ok without using up the link.
-- Blocks are checked against both the link's creator and the Pick's host / group's owner.
create function public.invite_accept(p_token text, p_user_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  c_group_cap constant integer := 25; -- 0012's group_add_members limit.
  v_link public.invite_links;
  v_pick public.picks%rowtype;
  v_owner uuid;
  v_member boolean;
  v_count integer;
  v_inserted integer := 0;
begin
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception using errcode = 'PT403', message = 'No profile for this user';
  end if;
  if private.join_rate_limited(p_user_id) then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  select * into v_link from public.invite_links
  where token = p_token and revoked_at is null and expires_at > now()
  for update;

  if found and v_link.kind = 'pick' then
    select * into v_pick from public.picks where id = v_link.target_id for update;
    if found and exists (
      select 1 from public.pick_participants where pick_id = v_pick.id and user_id = p_user_id
    ) then
      return jsonb_build_object('ok', true, 'kind', 'pick', 'targetId', v_pick.id);
    end if;
    if found and v_pick.state in ('draft', 'swiping') and not v_pick.lobby_locked
       and (v_link.max_uses is null or v_link.uses < v_link.max_uses)
       and (select count(*) from public.pick_participants where pick_id = v_pick.id)
           < private.pick_participant_cap()
       and not private.is_blocked_between(v_link.created_by, p_user_id)
       and not (v_pick.host_id is not null and private.is_blocked_between(v_pick.host_id, p_user_id)) then
      insert into public.pick_participants (pick_id, user_id) values (v_pick.id, p_user_id)
      on conflict do nothing;
      get diagnostics v_inserted = row_count;
    end if;
  elsif found and v_link.kind = 'group' and to_regclass('public.group_members') is not null then
    execute 'select owner_id from public.groups where id = $1 for update' into v_owner using v_link.target_id;
    if v_owner is not null then
      execute 'select exists (select 1 from public.group_members where group_id = $1 and user_id = $2),
                      (select count(*)::integer from public.group_members where group_id = $1)'
        into v_member, v_count using v_link.target_id, p_user_id;
      if v_member then
        return jsonb_build_object('ok', true, 'kind', 'group', 'targetId', v_link.target_id);
      end if;
      if v_count < c_group_cap
         and (v_link.max_uses is null or v_link.uses < v_link.max_uses)
         and not private.is_blocked_between(v_link.created_by, p_user_id)
         and not private.is_blocked_between(v_owner, p_user_id) then
        execute 'insert into public.group_members (group_id, user_id) values ($1, $2) on conflict do nothing'
          using v_link.target_id, p_user_id;
        get diagnostics v_inserted = row_count;
      end if;
    end if;
  end if;

  if v_inserted = 1 then
    update public.invite_links set uses = uses + 1 where token = v_link.token;
    return jsonb_build_object('ok', true, 'kind', v_link.kind, 'targetId', v_link.target_id);
  end if;

  insert into public.join_attempts (user_id, via) values (p_user_id, 'link');
  return jsonb_build_object('ok', false, 'reason', 'invalid');
end;
$$;

-- Creator only. Revoking twice is fine; anyone else's or an unknown token is PT404.
create function public.invite_revoke(p_token text, p_user_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.invite_links set revoked_at = coalesce(revoked_at, now())
  where token = p_token and created_by = p_user_id;
  if not found then
    raise exception using errcode = 'PT404', message = 'Invite not found';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Service role only.
-- ---------------------------------------------------------------------------
revoke all on function public.pick_set_lobby_locked(text, uuid, boolean) from public, anon, authenticated;
revoke all on function public.block_user(uuid, uuid) from public, anon, authenticated;
revoke all on function public.unblock_user(uuid, uuid) from public, anon, authenticated;
revoke all on function public.report_create(uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.rate_limit_take(uuid, text) from public, anon, authenticated;
revoke all on function public.invite_create(uuid, text, uuid, integer) from public, anon, authenticated;
revoke all on function public.invite_accept(text, uuid) from public, anon, authenticated;
revoke all on function public.invite_revoke(text, uuid) from public, anon, authenticated;
grant execute on function public.pick_set_lobby_locked(text, uuid, boolean) to service_role;
grant execute on function public.block_user(uuid, uuid) to service_role;
grant execute on function public.unblock_user(uuid, uuid) to service_role;
grant execute on function public.report_create(uuid, text, uuid, text) to service_role;
grant execute on function public.rate_limit_take(uuid, text) to service_role;
grant execute on function public.invite_create(uuid, text, uuid, integer) to service_role;
grant execute on function public.invite_accept(text, uuid) to service_role;
grant execute on function public.invite_revoke(text, uuid) to service_role;
