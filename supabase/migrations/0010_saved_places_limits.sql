-- Josh M4 Phase 1. Google saves retain IDs only; no Google content snapshots.
alter table public.picks
  add column price_max smallint check (price_max between 0 and 4),
  add column open_now boolean not null default false;
alter table public.profiles
  add column discover_preferences jsonb not null default '{}'::jsonb
  check (jsonb_typeof(discover_preferences) = 'object');

create table public.saved_places (
  user_id uuid not null references public.profiles(id) on delete cascade,
  place_id text not null check (length(place_id) between 1 and 256),
  created_at timestamptz not null default now(),
  primary key (user_id, place_id)
);
create table public.provider_usage (
  provider text not null check (provider = 'google'),
  day date not null,
  calls integer not null check (calls >= 0),
  primary key (provider, day)
);
create table public.rate_limit_counters (
  scope text not null check (scope in ('create', 'start', 'refresh')),
  subject text not null,
  bucket text not null,
  calls integer not null check (calls >= 0),
  primary key (scope, subject, bucket)
);
alter table public.saved_places enable row level security;
alter table public.provider_usage enable row level security;
alter table public.rate_limit_counters enable row level security;
revoke all on public.saved_places, public.provider_usage, public.rate_limit_counters from public, anon, authenticated;
grant select on public.saved_places to authenticated;
create policy "saved_places: own reads" on public.saved_places for select to authenticated using (user_id = auth.uid());
grant all on public.saved_places, public.provider_usage, public.rate_limit_counters to service_role;

-- Conditional UPSERT serializes callers on the unique key. Denied calls do not
-- increment. UTC day comes from the database, never the client/Edge clock.
create function public.consume_provider_call(p_limit integer) returns boolean
language plpgsql set search_path = '' as $$
declare v_calls integer;
begin
  if p_limit < 0 or p_limit is null then raise exception 'Invalid limit'; end if;
  if p_limit = 0 then return false; end if;
  insert into public.provider_usage(provider, day, calls)
    values ('google', (now() at time zone 'UTC')::date, 1)
  on conflict (provider, day) do update set calls = public.provider_usage.calls + 1
    where public.provider_usage.calls < p_limit returning calls into v_calls;
  return v_calls is not null;
end $$;
create function public.consume_user_limit(p_scope text, p_user_id uuid, p_pick_id text default null) returns boolean
language plpgsql set search_path = '' as $$
declare v_calls integer; v_limit integer; v_subject text; v_bucket text;
begin
  if p_scope = 'create' then
    v_limit := 20; v_subject := p_user_id::text; v_bucket := (now() at time zone 'UTC')::date::text;
  elsif p_scope in ('start', 'refresh') then
    -- Service role must still authorize; untrusted users cannot burn another host's quota.
    if not exists (select 1 from public.picks where id = private.try_uuid(p_pick_id) and host_id = p_user_id) then
      raise exception using errcode = 'PT403', message = 'Host required';
    end if;
    v_limit := 5; v_subject := p_pick_id; v_bucket := 'lifetime';
  else raise exception 'Invalid scope'; end if;
  insert into public.rate_limit_counters(scope, subject, bucket, calls) values (p_scope, v_subject, v_bucket, 1)
  on conflict (scope, subject, bucket) do update set calls = public.rate_limit_counters.calls + 1
    where public.rate_limit_counters.calls < v_limit returning calls into v_calls;
  return v_calls is not null;
end $$;

-- Wrap existing canonical create RPC, retaining its transaction and old callers.
create function public.pick_create_filtered(
  p_host_id uuid, p_category text, p_center_lat double precision, p_center_lng double precision,
  p_radius_m integer, p_pool_size integer, p_deadline_at timestamptz, p_close_threshold integer,
  p_price_max smallint default null, p_open_now boolean default false
) returns jsonb language plpgsql set search_path = '' as $$
declare v_result jsonb;
begin
  v_result := public.pick_create(p_host_id, p_category, p_center_lat, p_center_lng, p_radius_m, p_pool_size, p_deadline_at, p_close_threshold);
  update public.picks set price_max = p_price_max, open_now = p_open_now where id = (v_result->>'id')::uuid;
  return v_result;
end $$;
revoke all on function public.consume_provider_call(integer), public.consume_user_limit(text, uuid, text),
 public.pick_create_filtered(uuid, text, double precision, double precision, integer, integer, timestamptz, integer, smallint, boolean) from public, anon, authenticated;
grant execute on function public.consume_provider_call(integer), public.consume_user_limit(text, uuid, text),
 public.pick_create_filtered(uuid, text, double precision, double precision, integer, integer, timestamptz, integer, smallint, boolean) to service_role;

create function public.pick_load_filtered(p_pick_id text, p_user_id uuid) returns jsonb
language plpgsql stable set search_path = '' as $$
declare v_pick jsonb;
begin
  v_pick := public.pick_load(p_pick_id, p_user_id);
  if v_pick is null then return null; end if;
  return v_pick || (select jsonb_build_object('priceMax', price_max, 'openNow', open_now)
    from public.picks where id = (v_pick->>'id')::uuid);
end $$;
revoke all on function public.pick_load_filtered(text, uuid) from public, anon, authenticated;
grant execute on function public.pick_load_filtered(text, uuid) to service_role;
-- Existing profile policies allow shared-Pick display reads. Preferences stay private
-- behind the API, rather than inheriting those broader display-name read policies.
revoke select on public.profiles from authenticated;
grant select (id, display_name, avatar_url, created_at, updated_at) on public.profiles to authenticated;
