-- Lazy Discover photos: each cover is its own billed Google call, so it gets a separate daily
-- per-user counter. 200 is half of what 20 Discover loads with 20 photos each could cost.
alter table public.rate_limit_counters drop constraint rate_limit_counters_scope_check;
alter table public.rate_limit_counters add constraint rate_limit_counters_scope_check
 check (scope in ('create','start','refresh','discover','avatar_read','avatar_resolve',
  'username_lookup','discover_photo'));
create or replace function public.consume_user_limit(p_scope text, p_user_id uuid, p_pick_id text default null) returns boolean
language plpgsql set search_path = '' as $$
declare v_calls integer; v_limit integer; v_subject text; v_bucket text;
begin
  if p_scope in ('create', 'discover', 'discover_photo') then
    v_limit := case when p_scope = 'discover_photo' then 200 else 20 end;
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

-- Account deletion erases both text-keyed Discover counters.
create or replace function private.purge_discover_usage() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 delete from public.rate_limit_counters
  where scope in ('discover','discover_photo') and subject=old.id::text;
 return old;
end $$;
