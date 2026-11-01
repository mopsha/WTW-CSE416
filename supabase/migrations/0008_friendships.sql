-- Friends (Mike, M3). Contract: supabase/functions/api/friendsStore.ts,
-- docs/api-integration.md ("Friends").
--
-- Same discipline as 0002–0007: clients only SELECT (their own rows, through
-- RLS); every write is an RPC that is SECURITY INVOKER, executable only by
-- service_role, and raises SQLSTATE PT4xx for expected errors.
--
-- A friendship is one row per pair of people, whoever asked first:
--   pending  -> requester asked, addressee has not answered yet
--   accepted -> friends
-- Declining, canceling and unfriending all delete the row, so either person
-- can ask again later.
--
-- Finding someone: by the exact email they signed in with. Emails live only
-- in auth.users (profiles has none, on purpose), so the lookup is a private
-- security-definer helper that only the API's service role can call. The API
-- never returns anyone's email.

create table public.friendships (
  requester_id uuid not null references public.profiles (id) on delete cascade,
  addressee_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (requester_id, addressee_id),
  constraint friendships_not_self check (requester_id <> addressee_id),
  constraint friendships_accepted_at check ((status = 'accepted') = (accepted_at is not null))
);
comment on table public.friendships is 'Friend requests and friends, one row per pair. Readable by the two people in it; written only by the server.';
-- One row per pair in either direction: A->B blocks a second B->A row.
create unique index friendships_pair_key on public.friendships
  (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index friendships_addressee_id_idx on public.friendships (addressee_id);

alter table public.friendships enable row level security;
create policy "friendships: the two people in it" on public.friendships
  for select to authenticated
  using (requester_id = (select auth.uid()) or addressee_id = (select auth.uid()));

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
revoke all on table public.friendships from anon, authenticated;
grant select on table public.friendships to authenticated;
grant all on table public.friendships to service_role;

-- ---------------------------------------------------------------------------
-- Profiles: people I have a friendship row with (friends, and requests either
-- way) can read each other's display name, so the Friends tab can label them.
-- The 0001 policy (self and co-participants) stays; policies are OR'ed.
-- ---------------------------------------------------------------------------
create function private.has_friendship_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.friendships
    where (requester_id = (select auth.uid()) and addressee_id = p_user_id)
       or (addressee_id = (select auth.uid()) and requester_id = p_user_id)
  );
$$;
revoke all on function private.has_friendship_with(uuid) from public, anon;
grant execute on function private.has_friendship_with(uuid) to authenticated, service_role;

create policy "profiles: friends and friend requests" on public.profiles
  for select to authenticated
  using (private.has_friendship_with(id));

-- ---------------------------------------------------------------------------
-- Email lookup (service role only; never exposed to clients).
-- ---------------------------------------------------------------------------
create function private.user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id from auth.users u
  where lower(u.email) = lower(trim(p_email))
  limit 1;
$$;
revoke all on function private.user_id_by_email(text) from public, anon, authenticated;
grant execute on function private.user_id_by_email(text) to service_role;

-- ---------------------------------------------------------------------------
-- friend_request: ask someone by email. If they already asked me, this
-- accepts instead. Returns { userId, displayName, status }.
-- ---------------------------------------------------------------------------
create function public.friend_request(p_user_id uuid, p_email text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_other uuid := private.user_id_by_email(p_email);
  v_row public.friendships;
begin
  if v_other is null or not exists (select 1 from public.profiles where id = v_other) then
    raise exception using errcode = 'PT404', message = 'No WTW account uses that email';
  end if;
  if v_other = p_user_id then
    raise exception using errcode = 'PT400', message = 'You cannot add yourself';
  end if;

  -- Two attempts: if a concurrent request for the same pair wins the insert,
  -- the second pass finds its row.
  for attempt in 1..2 loop
    select * into v_row from public.friendships
    where least(requester_id, addressee_id) = least(p_user_id, v_other)
      and greatest(requester_id, addressee_id) = greatest(p_user_id, v_other)
    for update;

    if found then
      if v_row.status = 'pending' and v_row.addressee_id = p_user_id then
        update public.friendships
        set status = 'accepted', accepted_at = now()
        where requester_id = v_row.requester_id and addressee_id = v_row.addressee_id
        returning * into v_row;
      end if;
      exit;
    end if;

    insert into public.friendships (requester_id, addressee_id)
    values (p_user_id, v_other)
    on conflict do nothing
    returning * into v_row;
    exit when v_row.requester_id is not null;
  end loop;

  return jsonb_build_object(
    'userId', v_other,
    'displayName', (select display_name from public.profiles where id = v_other),
    'status', v_row.status
  );
exception
  when foreign_key_violation then
    raise exception using errcode = 'PT403', message = 'No profile for this user';
end;
$$;
revoke all on function public.friend_request(uuid, text) from public, anon, authenticated;
grant execute on function public.friend_request(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- friend_accept: accept a pending request someone sent me. Accepting twice is
-- fine; anything else (no request, or one I sent) is PT404.
-- ---------------------------------------------------------------------------
create function public.friend_accept(p_user_id uuid, p_friend_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.friendships
  set status = 'accepted', accepted_at = now()
  where requester_id = p_friend_id and addressee_id = p_user_id and status = 'pending';
  if found then return; end if;
  if exists (
    select 1 from public.friendships
    where requester_id = p_friend_id and addressee_id = p_user_id and status = 'accepted'
  ) then
    return;
  end if;
  raise exception using errcode = 'PT404', message = 'No friend request from this person';
end;
$$;
revoke all on function public.friend_accept(uuid, uuid) from public, anon, authenticated;
grant execute on function public.friend_accept(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- friend_remove: decline an incoming request, cancel an outgoing one, or
-- unfriend. Idempotent: removing nothing is not an error.
-- ---------------------------------------------------------------------------
create function public.friend_remove(p_user_id uuid, p_friend_id uuid)
returns void
language sql
set search_path = ''
as $$
  delete from public.friendships
  where (requester_id = p_user_id and addressee_id = p_friend_id)
     or (requester_id = p_friend_id and addressee_id = p_user_id);
$$;
revoke all on function public.friend_remove(uuid, uuid) from public, anon, authenticated;
grant execute on function public.friend_remove(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- friend_list: everyone I have a row with, newest first, with their display
-- name and which way the request went. The API groups them.
-- ---------------------------------------------------------------------------
create function public.friend_list(p_user_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(item order by sort_at desc), '[]'::jsonb)
  from (
    select
      jsonb_build_object(
        'userId', p.id,
        'displayName', p.display_name,
        'status', f.status,
        'direction', case when f.requester_id = p_user_id then 'out' else 'in' end,
        'createdAt', f.created_at,
        'acceptedAt', f.accepted_at
      ) as item,
      coalesce(f.accepted_at, f.created_at) as sort_at
    from public.friendships f
    join public.profiles p
      on p.id = case when f.requester_id = p_user_id then f.addressee_id else f.requester_id end
    where f.requester_id = p_user_id or f.addressee_id = p_user_id
  ) friends;
$$;
revoke all on function public.friend_list(uuid) from public, anon, authenticated;
grant execute on function public.friend_list(uuid) to service_role;
