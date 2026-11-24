-- Run with discover_location_upgrade.py on the schema immediately before 0061.
begin;
set local role service_role;
do $$
begin
  if public.consume_login_limit(array['client:discover-upgrade'],array[2]) is null then
    raise exception 'Expected a legitimate pre-0061 password reservation';
  end if;
end $$;
reset role;

\ir ../../supabase/migrations/0061_discover_location_limit.sql

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
commit;
