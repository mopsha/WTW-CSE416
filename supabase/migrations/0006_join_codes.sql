-- Join codes and joining a Pick by code (Razin). M3, fixes docs/bugs.md #9.
-- Contract: supabase/functions/api/joinStore.ts, docs/api-integration.md.
--
-- Same discipline as 0002–0004: the RPC is SECURITY INVOKER, executable only by
-- service_role, raises SQLSTATE PT404 / PT409 for expected errors, and locks the
-- Pick row before any read-then-write.
--
-- Joining rule: a Pick accepts new people only while it is `draft` or `swiping`.
-- `ranking` and `final_vote` are closed to newcomers (someone who never swiped
-- must not vote), and `completed` / `canceled` are over. Someone who is already
-- a participant always succeeds, in any state, without a second row.

-- ---------------------------------------------------------------------------
-- Fix for 0005 (docs/bugs.md #13): 0005 publishes pick_participants to
-- Realtime, but the table has no primary key, so it has no replica identity
-- and Postgres rejects every UPDATE on it (SQLSTATE 55000). That includes
-- 0005's own finished_at trigger, i.e. everyone's last swipe, and the seed.
-- Use the existing unique (pick_id, user_id) index; both columns are not null.
-- ---------------------------------------------------------------------------
alter table public.pick_participants
  replica identity using index pick_participants_pick_user_key;

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
-- Codes are 6 characters from an alphabet with no 0/O/1/I (the same one the
-- app's mock uses). They are unique for all time, not only among unexpired
-- codes: 32^6 ≈ 1.07 billion combinations, so a code is never reused and an
-- old QR code can never land someone in a different Pick.
create table public.pick_join_codes (
  code text primary key check (code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  pick_id uuid not null references public.picks (id) on delete cascade,
  -- Not null: the app reads the newest code with ORDER BY expires_at DESC,
  -- where a NULL would sort first.
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
comment on table public.pick_join_codes is 'Share codes for joining a Pick (wtw://join/CODE). Readable by the Pick''s participants; written only by the server.';
create index pick_join_codes_pick_id_idx on public.pick_join_codes (pick_id, expires_at desc);

alter table public.pick_join_codes enable row level security;
create policy "pick_join_codes: participants" on public.pick_join_codes
  for select to authenticated
  using (private.is_pick_participant(pick_id));

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
revoke all on table public.pick_join_codes from anon, authenticated;
grant select on table public.pick_join_codes to authenticated;
grant all on table public.pick_join_codes to service_role;

-- ---------------------------------------------------------------------------
-- Issuing codes: every new Pick gets one (trigger), whoever inserts it
-- (pick_create, the seed, a test).
-- ---------------------------------------------------------------------------
create function private.issue_join_code(p_pick_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  v_code text;
begin
  -- A collision is about one in a billion per attempt; retry a few times.
  for attempt in 1..10 loop
    -- 32 divides 256, so byte % 32 is unbiased. Crypto-random, not random().
    v_bytes := extensions.gen_random_bytes(6);
    v_code := '';
    for i in 0..5 loop
      v_code := v_code || substr(c_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
    end loop;
    begin
      insert into public.pick_join_codes (code, pick_id, expires_at)
      values (v_code, p_pick_id, now() + interval '7 days');
      return v_code;
    exception when unique_violation then
      -- Try another code.
    end;
  end loop;
  raise exception 'Could not issue a unique join code';
end;
$$;
revoke all on function private.issue_join_code(uuid) from public, anon, authenticated;

create function private.picks_issue_join_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.issue_join_code(new.id);
  return null;
end;
$$;
revoke all on function private.picks_issue_join_code() from public, anon, authenticated;

create trigger picks_issue_join_code
  after insert on public.picks
  for each row execute function private.picks_issue_join_code();

-- Backfill: Picks that can still be joined and have no live code.
select private.issue_join_code(p.id)
from public.picks p
where p.state in ('draft', 'swiping')
  and not exists (
    select 1 from public.pick_join_codes j where j.pick_id = p.id and j.expires_at > now()
  );

-- ---------------------------------------------------------------------------
-- pick_join: join by code. Returns the Pick id.
-- ---------------------------------------------------------------------------
create function public.pick_join(p_code text, p_user_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  -- Codes are typed by people: ignore case and spaces.
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
  v_pick_id uuid;
  v_state public.pick_state;
begin
  select pick_id into v_pick_id
  from public.pick_join_codes
  where code = v_code and expires_at > now();
  if not found then
    raise exception using errcode = 'PT404', message = 'Join code not found or expired';
  end if;

  -- Same lock as every other Pick writer; the participant insert below bumps
  -- picks.version through the 0002 trigger.
  select state into v_state from public.picks where id = v_pick_id for update;

  if exists (
    select 1 from public.pick_participants where pick_id = v_pick_id and user_id = p_user_id
  ) then
    return v_pick_id;
  end if;

  if v_state not in ('draft', 'swiping') then
    raise exception using errcode = 'PT409', message = 'This Pick is no longer accepting people';
  end if;

  insert into public.pick_participants (pick_id, user_id)
  values (v_pick_id, p_user_id)
  on conflict do nothing;
  return v_pick_id;
exception
  when foreign_key_violation then
    raise exception using errcode = 'PT403', message = 'No profile for this user';
end;
$$;

revoke all on function public.pick_join(text, uuid) from public, anon, authenticated;
grant execute on function public.pick_join(text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- ranking_results: participants only, and only once the Pick has left
-- swiping. Rows are normally written at close, but the policy should not
-- depend on that.
-- ---------------------------------------------------------------------------
create function private.pick_has_closed(p_pick_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.picks where id = p_pick_id and state not in ('draft', 'swiping')
  );
$$;
revoke all on function private.pick_has_closed(uuid) from public, anon;
grant execute on function private.pick_has_closed(uuid) to authenticated, service_role;

drop policy "ranking_results: participants" on public.ranking_results;
create policy "ranking_results: participants, after swiping" on public.ranking_results
  for select to authenticated
  using (private.is_pick_participant(pick_id) and private.pick_has_closed(pick_id));
