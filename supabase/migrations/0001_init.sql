-- WTW initial schema (Razin).
--
-- Rules this file enforces:
--   * The "api" Edge Function (service_role) is the ONLY writer. Clients never get
--     INSERT / UPDATE / DELETE, neither by grant nor by RLS policy.
--   * Clients (authenticated role, never anon) may only SELECT rows of Picks they
--     participate in, and only their own preferences.
--   * ranking_results.score is not readable by clients (column-level grant).
--   * Grants are explicit; nothing relies on Supabase's default "expose new tables".

-- ---------------------------------------------------------------------------
-- Private schema for helpers. Not exposed through the Data API (PostgREST).
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.pick_state as enum (
  'draft', 'swiping', 'ranking', 'final_vote', 'completed', 'canceled'
);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 50),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.profiles is 'One row per account, created automatically on first sign-in. No email here (privacy).';

create table public.places (
  id text primary key check (char_length(id) between 1 and 256),
  name text not null,
  category text not null check (category in ('food', 'activities')),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  raw jsonb,
  updated_at timestamptz not null default now()
);
comment on table public.places is 'Normalized provider places. id is the provider place id (text).';

create table public.picks (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles (id) on delete cascade,
  state public.pick_state not null default 'draft',
  category text not null check (category in ('food', 'activities')),
  center_lat double precision not null check (center_lat between -90 and 90),
  center_lng double precision not null check (center_lng between -180 and 180),
  radius_m integer not null check (radius_m > 0 and radius_m <= 50000),
  deadline_at timestamptz,
  close_threshold integer not null default 100 check (close_threshold between 1 and 100),
  winner_place_id text references public.places (id),
  decided_at timestamptz,
  decided_by text check (decided_by in ('clear_winner', 'vote')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Winner metadata is all-or-nothing.
  constraint picks_winner_consistent check (
    (winner_place_id is null and decided_at is null and decided_by is null)
    or (winner_place_id is not null and decided_at is not null and decided_by is not null)
  )
);
comment on column public.picks.close_threshold is 'Percent of participants who must finish swiping before the system closes the Pick.';
create index picks_host_id_idx on public.picks (host_id);

create table public.pick_participants (
  pick_id uuid not null references public.picks (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint pick_participants_pick_user_key unique (pick_id, user_id)
);
create index pick_participants_user_id_idx on public.pick_participants (user_id);

create table public.pick_candidates (
  pick_id uuid not null references public.picks (id) on delete cascade,
  place_id text not null references public.places (id),
  -- What this Pick shows, frozen at creation: { name, photoUrl, priceLevel, rating, lat, lng }.
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object' and snapshot ? 'name'),
  created_at timestamptz not null default now(),
  primary key (pick_id, place_id)
);
create index pick_candidates_place_id_idx on public.pick_candidates (place_id);

-- The winner must be one of the Pick's candidates (MATCH SIMPLE: skipped while null).
alter table public.picks
  add constraint picks_winner_is_candidate
  foreign key (id, winner_place_id) references public.pick_candidates (pick_id, place_id);

create table public.preferences (
  pick_id uuid not null,
  place_id text not null,
  user_id uuid not null,
  value smallint not null constraint preferences_value_range check (value between 0 and 2),
  updated_at timestamptz not null default now(),
  constraint preferences_pick_place_user_key unique (pick_id, place_id, user_id),
  -- Only a candidate of this Pick, only by a participant of this Pick.
  foreign key (pick_id, place_id) references public.pick_candidates (pick_id, place_id) on delete cascade,
  foreign key (pick_id, user_id) references public.pick_participants (pick_id, user_id) on delete cascade
);
comment on column public.preferences.value is '0 = No, 1 = Maybe, 2 = Yes. Private to the user who gave it.';
create index preferences_user_id_idx on public.preferences (user_id);

create table public.ranking_results (
  pick_id uuid not null,
  place_id text not null,
  rank integer not null check (rank >= 1),
  finalist boolean not null default false,
  score double precision not null check (score between 0 and 100),
  created_at timestamptz not null default now(),
  primary key (pick_id, place_id),
  constraint ranking_results_pick_rank_key unique (pick_id, rank),
  foreign key (pick_id, place_id) references public.pick_candidates (pick_id, place_id) on delete cascade
);
comment on column public.ranking_results.score is 'Server-only. Never granted to clients; used for tests and debugging.';

-- ---------------------------------------------------------------------------
-- Profile on first sign-in
-- ---------------------------------------------------------------------------
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    nullif(left(trim(new.raw_user_meta_data ->> 'display_name'), 50), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- RLS helpers (security definer so policies do not recurse through RLS)
-- ---------------------------------------------------------------------------
create function private.is_pick_participant(p_pick_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.pick_participants
    where pick_id = p_pick_id and user_id = (select auth.uid())
  );
$$;

create function private.shares_pick_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.pick_participants me
    join public.pick_participants them on them.pick_id = me.pick_id
    where me.user_id = (select auth.uid()) and them.user_id = p_user_id
  );
$$;

create function private.can_see_place(p_place_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.pick_candidates c
    join public.pick_participants p on p.pick_id = c.pick_id
    where c.place_id = p_place_id and p.user_id = (select auth.uid())
  );
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security: SELECT policies only. No write policies for clients.
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.places enable row level security;
alter table public.picks enable row level security;
alter table public.pick_participants enable row level security;
alter table public.pick_candidates enable row level security;
alter table public.preferences enable row level security;
alter table public.ranking_results enable row level security;

create policy "profiles: self and co-participants" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or private.shares_pick_with(id));

create policy "places: candidates of my Picks" on public.places
  for select to authenticated
  using (private.can_see_place(id));

create policy "picks: participants" on public.picks
  for select to authenticated
  using (private.is_pick_participant(id));

create policy "pick_participants: participants of the same Pick" on public.pick_participants
  for select to authenticated
  using (private.is_pick_participant(pick_id));

create policy "pick_candidates: participants" on public.pick_candidates
  for select to authenticated
  using (private.is_pick_participant(pick_id));

create policy "preferences: only my own" on public.preferences
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "ranking_results: participants" on public.ranking_results
  for select to authenticated
  using (private.is_pick_participant(pick_id));

-- ---------------------------------------------------------------------------
-- Grants (explicit; hosted project has auto-expose of new tables turned off)
-- ---------------------------------------------------------------------------
-- Stop future objects created by postgres in public from being auto-granted to
-- client roles, so local matches the hosted setting.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from public, anon, authenticated;

revoke all on table
  public.profiles, public.places, public.picks, public.pick_participants,
  public.pick_candidates, public.preferences, public.ranking_results
from anon, authenticated;

grant usage on schema public to authenticated, service_role;

grant select on table
  public.profiles, public.places, public.picks, public.pick_participants,
  public.pick_candidates, public.preferences
to authenticated;

-- Column grant: everything except score. `select=*` from a client fails with
-- "permission denied" instead of leaking scores.
grant select (pick_id, place_id, rank, finalist, created_at) on table public.ranking_results to authenticated;

grant all on table
  public.profiles, public.places, public.picks, public.pick_participants,
  public.pick_candidates, public.preferences, public.ranking_results
to service_role;
grant usage on type public.pick_state to authenticated, service_role;

-- Helper functions: callable from policies by authenticated, never via RPC (private schema).
revoke all on function private.handle_new_user() from public, anon, authenticated;
revoke all on function private.is_pick_participant(uuid) from public, anon;
revoke all on function private.shares_pick_with(uuid) from public, anon;
revoke all on function private.can_see_place(text) from public, anon;
grant usage on schema private to authenticated, service_role;
grant execute on function private.is_pick_participant(uuid) to authenticated, service_role;
grant execute on function private.shares_pick_with(uuid) to authenticated, service_role;
grant execute on function private.can_see_place(text) to authenticated, service_role;
