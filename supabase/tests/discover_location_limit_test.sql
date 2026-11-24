-- Standalone TAP: Discover location lookups share an independent UTC-day quota.
begin;
select '1..5';
insert into auth.users(id,raw_user_meta_data) values
 ('d3333333-3333-4333-8333-333333333333','{}'),
 ('d3333333-3333-4333-8333-333333333334','{}');
set local role service_role;
do $$
declare
 u uuid := 'd3333333-3333-4333-8333-333333333333';
begin
 for i in 1..60 loop
  if not public.consume_user_limit('discover_location',u) then
   raise exception 'Early location denial at %',i;
  end if;
 end loop;
 if public.consume_user_limit('discover_location',u) then raise exception 'Location quota exceeded'; end if;
end $$;
select 'ok 1 - location requests are limited to 60 per account per UTC day';
do $$
declare
 u uuid := 'd3333333-3333-4333-8333-333333333333';
begin
 if not public.consume_user_limit('discover',u) or not public.consume_user_limit('discover_photo',u)
  or not public.consume_user_limit('discover_location','d3333333-3333-4333-8333-333333333334') then
   raise exception 'Location quota affected other scopes or accounts';
 end if;
end $$;
select 'ok 2 - quota is independent of feed, photo, and other account quotas';
-- Generate active and expired rows from database UTC, independent of session time zone.
set local timezone = 'Pacific/Honolulu';
do $$
declare
 u text := 'd3333333-3333-4333-8333-333333333333';
 today date := (now() at time zone 'UTC')::date;
 yesterday text := (today - 1)::text;
begin
 insert into public.rate_limit_counters(scope,subject,bucket,calls) values
  ('discover_location',u,yesterday,60),
  ('discover_location',u,(today + 1)::text,1),
  ('discover',u,yesterday,1),
  ('discover_photo',u,yesterday,1),
  ('password_login',md5(u),yesterday || 'T00:00',1);

 perform public.purge_discover_location_limits();
 if exists (select 1 from public.rate_limit_counters
    where scope='discover_location' and subject=u and bucket=yesterday) then
  raise exception 'Expired location quota was retained';
 end if;
 if (select calls from public.rate_limit_counters
     where scope='discover_location' and subject=u and bucket=today::text) is distinct from 60
    or not exists (select 1 from public.rate_limit_counters
     where scope='discover_location' and subject=u and bucket=(today + 1)::text) then
  raise exception 'Cleanup changed an active or future quota';
 end if;
 if (select count(*) from public.rate_limit_counters
     where (scope in ('discover','discover_photo') and subject=u and bucket=yesterday)
       or (scope='password_login' and subject=md5(u) and bucket=yesterday || 'T00:00')) <> 3 then
  raise exception 'Cleanup changed an unrelated scope';
 end if;
end $$;
select 'ok 3 - UTC cleanup removes only expired location buckets';
reset role;
delete from auth.users where id='d3333333-3333-4333-8333-333333333333';
do $$ begin
 if exists(select 1 from public.rate_limit_counters
  where subject='d3333333-3333-4333-8333-333333333333') then
  raise exception 'Deleted account retained Discover counters';
 end if;
end $$;
select 'ok 4 - account deletion erases the new counter';
do $$ begin
 if has_function_privilege('anon','public.purge_discover_location_limits()','execute')
    or has_function_privilege('authenticated','public.purge_discover_location_limits()','execute')
    or not has_function_privilege('service_role','public.purge_discover_location_limits()','execute') then
  raise exception 'Location cleanup has unexpected privileges';
 end if;
end $$;
select 'ok 5 - cleanup is service-role only';
rollback;
