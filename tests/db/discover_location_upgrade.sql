-- Run with discover_location_upgrade.py on the schema immediately before 0061.
begin;
set local role service_role;
do $$
begin
  if public.consume_login_limit(array['client:discover-upgrade'],array[2]) is null then
    raise exception 'Expected a legitimate pre-0061 password reservation';
  end if;
end $$;
select public.consume_provider_call(100);
reset role;

\ir ../../supabase/migrations/0061_discover_location_limit.sql
\ir ../../supabase/migrations/0062_discover_location_provider_budget.sql

set local role service_role;
do $$
declare u uuid := 'd3333333-3333-4333-8333-333333333336';
begin
  if (select calls from public.rate_limit_counters
      where scope='password_login' and subject=md5('client:discover-upgrade')) is distinct from 1 then
    raise exception 'Migration changed the existing password counter';
  end if;
  if public.consume_login_limit(array['client:discover-upgrade'],array[2]) is null then
    raise exception 'Password reservations stopped working after 0061';
  end if;
  if public.consume_login_limit(array['client:discover-upgrade'],array[2]) is not null then
    raise exception 'Password quota did not count the pre-0061 reservation';
  end if;
  for i in 1..60 loop
    if not public.consume_user_limit('discover_location',u) then
      raise exception 'Early location quota denial at %',i;
    end if;
  end loop;
  if public.consume_user_limit('discover_location',u) then
    raise exception 'Location quota exceeded';
  end if;
end $$;
do $$
declare
  utc_day date := (now() at time zone 'UTC')::date;
begin
  if not exists (
    select 1 from public.provider_usage
    where provider = 'google' and day = utc_day and calls = 1 and location_calls = 0
  ) then
    raise exception 'Upgrade changed existing aggregate Google usage';
  end if;
  if public.consume_location_provider_call(0) or public.consume_location_provider_call(9) then
    raise exception 'A disabled or very small global cap admitted a location call';
  end if;
  if not public.consume_location_provider_call(10) or public.consume_location_provider_call(10) then
    raise exception 'Location allowance did not scale down with the global cap';
  end if;
  for i in 2..10 loop
    if not public.consume_location_provider_call(1000) then
      raise exception 'Early global location quota denial at %', i;
    end if;
  end loop;
  if public.consume_location_provider_call(1000) or not public.consume_provider_call(100) then
    raise exception 'Location quota grew with configuration or blocked a core reservation';
  end if;
  if not exists (
    select 1 from public.provider_usage
    where provider = 'google' and day = utc_day and calls = 12 and location_calls = 10
  ) then
    raise exception 'Provider usage did not count exactly the admitted calls';
  end if;
  delete from public.provider_usage where provider = 'google' and day = utc_day;
  -- Core traffic can fill the entire aggregate budget.
  for i in 1..10 loop
    if not public.consume_provider_call(10) then
      raise exception 'Core calls cannot use the full configured cap';
    end if;
  end loop;
  if public.consume_location_provider_call(10) or public.consume_provider_call(10) then
    raise exception 'A reservation exceeded the aggregate cap';
  end if;
  delete from public.provider_usage where provider = 'google' and day = utc_day;
  if has_function_privilege('anon','public.consume_location_provider_call(integer)','execute')
     or has_function_privilege('authenticated','public.consume_location_provider_call(integer)','execute') then
    raise exception 'Untrusted role can spend the provider budget directly';
  end if;
end $$;
delete from public.rate_limit_counters where
  (scope = 'password_login' and subject = md5('client:discover-upgrade'))
  or (scope = 'discover_location' and subject = 'd3333333-3333-4333-8333-333333333336');
reset role;
delete from private.login_reservations where subjects = array[md5('client:discover-upgrade')];
commit;
