-- Autocomplete and resolution share a per-account budget independent of feed loads.
alter table public.rate_limit_counters drop constraint rate_limit_counters_scope_check;
alter table public.rate_limit_counters add constraint rate_limit_counters_scope_check
 check (scope in ('create','start','refresh','discover','avatar_read','avatar_resolve',
  'username_lookup','discover_photo','password_login','discover_location'));
create or replace function public.consume_user_limit(p_scope text, p_user_id uuid, p_pick_id text default null) returns boolean
language plpgsql set search_path = '' as $$
declare v_calls integer; v_limit integer; v_subject text; v_bucket text;
begin
  if p_scope in ('create', 'discover', 'discover_photo', 'discover_location') then
    v_limit := case p_scope when 'discover_photo' then 200 when 'discover_location' then 60 else 20 end;
    v_subject := p_user_id::text; v_bucket := (now() at time zone 'UTC')::date::text;
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

-- Account deletion erases all text-keyed Discover counters.
create or replace function private.purge_discover_usage() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 delete from public.rate_limit_counters
  where scope in ('discover','discover_photo','discover_location') and subject=old.id::text;
 return old;
end $$;

-- Use database UTC so a caller-supplied sweep date cannot remove the active bucket.
create function public.purge_discover_location_limits() returns integer
language plpgsql security invoker set search_path = '' as $$
declare v_removed integer;
begin
  delete from public.rate_limit_counters
  where scope = 'discover_location'
    and bucket < (now() at time zone 'UTC')::date::text;
  get diagnostics v_removed = row_count;
  return v_removed;
end $$;

revoke all on function public.purge_discover_location_limits() from public, anon, authenticated;
grant execute on function public.purge_discover_location_limits() to service_role;
