-- Standalone TAP: cache privacy, TTL, atomic daily claim, Discover quota.
begin;
select '1..6';
insert into auth.users(id,raw_user_meta_data) values
 ('d1111111-1111-4111-8111-111111111111','{}');
set local role service_role;
do $$ declare i integer; u uuid := 'd1111111-1111-4111-8111-111111111111'; begin
 for i in 1..20 loop
  if not public.consume_user_limit('discover',u) then raise exception 'Early Discover denial'; end if;
 end loop;
 if public.consume_user_limit('discover',u) then raise exception 'Discover over quota'; end if;
 if not public.consume_user_limit('create',u) then raise exception 'Discover consumed create quota'; end if;
end $$;
select 'ok 1 - Discover is limited to 20 per UTC day without consuming create quota';
insert into public.place_cache(key,entry,fetched_at) values
 ('expired','{"provider":"google","placeIds":["id-only"]}', now()-interval '6 minutes'),
 ('boundary','{"provider":"mock","candidates":[]}', now()-interval '5 minutes'),
 ('fresh','{"provider":"mock","candidates":[]}', now());
do $$ begin
 begin
  insert into public.place_cache(key,entry,fetched_at) values
   ('forbidden','{"provider":"google","placeIds":[],"name":"restricted content"}',now());
  raise exception 'Google content persisted';
 exception when check_violation then null; end;
end $$;
select 'ok 2 - Google entries cannot include display content';
do $$ declare r jsonb; begin
 r := public.cleanup_place_cache((now() at time zone 'UTC')::date, now()-interval '5 minutes');
 if r <> '{"ran":true,"removed":2}'::jsonb then raise exception 'Wrong cleanup count or TTL: %',r; end if;
 if not exists(select 1 from public.place_cache where key='fresh') then raise exception 'Fresh row removed'; end if;
 r := public.cleanup_place_cache((now() at time zone 'UTC')::date, now());
 if r <> '{"ran":false,"removed":0}'::jsonb then raise exception 'Daily claim repeated'; end if;
end $$;
select 'ok 3 - cleanup deletes at TTL boundary, preserves fresh rows, runs once per day';
reset role;
set local role authenticated;
do $$ begin
 begin perform * from public.place_cache; raise exception 'Cache leaked';
 exception when insufficient_privilege then null; end;
 begin perform public.cleanup_place_cache(current_date,now()); raise exception 'Cleanup exposed';
 exception when insufficient_privilege then null; end;
end $$;
select 'ok 4 - clients cannot read cache or execute cleanup';
reset role;
set local role anon;
do $$ begin
 begin perform * from public.place_cache; raise exception 'Anonymous cache leaked';
 exception when insufficient_privilege then null; end;
 begin perform public.consume_user_limit('discover','d1111111-1111-4111-8111-111111111111'); raise exception 'Quota RPC exposed';
 exception when insufficient_privilege then null; end;
end $$;
select 'ok 5 - anonymous cache and quota access denied';
reset role;
delete from auth.users where id='d1111111-1111-4111-8111-111111111111';
do $$ begin
 if exists(select 1 from public.rate_limit_counters where scope='discover'
  and subject='d1111111-1111-4111-8111-111111111111') then
  raise exception 'Deleted account retained Discover counter'; end if;
end $$;
select 'ok 6 - account deletion erases the new per-user Discover counter';
rollback;
