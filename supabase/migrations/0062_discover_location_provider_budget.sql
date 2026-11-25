-- Location lookups count toward Google's aggregate daily cap, but may spend
-- at most 10 calls and at most 10% of that cap. Core calls can use any capacity
-- still available. Both counters are updated on the same locked UTC-day row.
alter table public.provider_usage add column location_calls integer not null default 0
  check (location_calls >= 0 and location_calls <= calls);

create function public.consume_location_provider_call(p_limit integer) returns boolean
language plpgsql set search_path = '' as $$
declare
  v_calls integer;
  v_location_limit integer;
begin
  if p_limit < 0 or p_limit is null then raise exception 'Invalid limit'; end if;
  v_location_limit := least(10, p_limit / 10);
  if v_location_limit = 0 then return false; end if;

  insert into public.provider_usage(provider, day, calls, location_calls)
    values ('google', (now() at time zone 'UTC')::date, 1, 1)
  on conflict (provider, day) do update
    set calls = public.provider_usage.calls + 1,
        location_calls = public.provider_usage.location_calls + 1
    where public.provider_usage.calls < p_limit
      and public.provider_usage.location_calls < v_location_limit
    returning calls into v_calls;
  return v_calls is not null;
end $$;

revoke all on function public.consume_location_provider_call(integer) from public, anon, authenticated;
grant execute on function public.consume_location_provider_call(integer) to service_role;
