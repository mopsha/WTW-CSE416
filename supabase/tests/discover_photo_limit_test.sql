-- Standalone TAP: lazy Discover photo quota.
begin;
select '1..3';
insert into auth.users(id,raw_user_meta_data) values
 ('d2222222-2222-4222-8222-222222222222','{}');
set local role service_role;
do $$ declare i integer; u uuid := 'd2222222-2222-4222-8222-222222222222'; begin
 for i in 1..200 loop
  if not public.consume_user_limit('discover_photo',u) then raise exception 'Early photo denial at %',i; end if;
 end loop;
 if public.consume_user_limit('discover_photo',u) then raise exception 'Photos over quota'; end if;
end $$;
select 'ok 1 - Discover photos are limited to 200 per UTC day';
do $$ declare u uuid := 'd2222222-2222-4222-8222-222222222222'; begin
 if not public.consume_user_limit('discover',u) then raise exception 'Photos consumed Discover quota'; end if;
end $$;
select 'ok 2 - the photo quota is separate from the Discover quota';
reset role;
delete from auth.users where id='d2222222-2222-4222-8222-222222222222';
do $$ begin
 if exists(select 1 from public.rate_limit_counters
  where subject='d2222222-2222-4222-8222-222222222222') then
  raise exception 'Deleted account retained Discover counters'; end if;
end $$;
select 'ok 3 - account deletion erases both Discover counters';
rollback;
