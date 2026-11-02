-- Josh M4: bounded Discover requests and durable, retention-safe search cache.
alter table public.rate_limit_counters drop constraint rate_limit_counters_scope_check;
alter table public.rate_limit_counters add constraint rate_limit_counters_scope_check
 check (scope in ('create','start','refresh','discover'));
create or replace function public.consume_user_limit(p_scope text, p_user_id uuid, p_pick_id text default null) returns boolean
language plpgsql set search_path = '' as $$
declare v_calls integer; v_limit integer; v_subject text; v_bucket text;
begin
  if p_scope in ('create', 'discover') then
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


create table public.place_cache (
 key text primary key,
 entry jsonb not null,
 fetched_at timestamptz not null,
 constraint place_cache_provider check (entry->>'provider' is not null and entry->>'provider' in ('mock','google')),
 constraint place_cache_google_ids_only check (entry->>'provider' <> 'google' or
  (entry - array['key','query','fetchedAt','provider','placeIds'] = '{}'::jsonb
   and coalesce(jsonb_typeof(entry->'placeIds') = 'array',false)
   and not jsonb_path_exists(entry, '$.placeIds[*] ? (@.type() != "string")')))
);
create index place_cache_expiry on public.place_cache(fetched_at);
alter table public.place_cache enable row level security;
revoke all on public.place_cache from public, anon, authenticated;
grant all on public.place_cache to service_role;
create table private.place_cache_cleanup_days(day date primary key);
revoke all on private.place_cache_cleanup_days from public, anon, authenticated;

-- Claim and deletion share a transaction. Failures roll the claim back for retry.
create function public.cleanup_place_cache(p_day date, p_cutoff timestamptz)
returns jsonb language plpgsql set search_path = '' as $$
declare v_removed integer;
begin
 insert into private.place_cache_cleanup_days(day) values(p_day) on conflict do nothing;
 if not found then return jsonb_build_object('ran',false,'removed',0); end if;
 delete from public.place_cache where fetched_at <= p_cutoff;
 get diagnostics v_removed = row_count;
 delete from private.place_cache_cleanup_days where day < p_day - 7;
 return jsonb_build_object('ran',true,'removed',v_removed);
end $$;
revoke all on function public.cleanup_place_cache(date,timestamptz) from public, anon, authenticated;
grant execute on function public.cleanup_place_cache(date,timestamptz) to service_role;
grant all on private.place_cache_cleanup_days to service_role;

-- The new counter is keyed by text, so account deletion must explicitly erase it.
create function private.purge_discover_usage() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 delete from public.rate_limit_counters where scope='discover' and subject=old.id::text;
 return old;
end $$;
revoke all on function private.purge_discover_usage() from public, anon, authenticated;
create trigger purge_discover_usage after delete on public.profiles
 for each row execute function private.purge_discover_usage();
