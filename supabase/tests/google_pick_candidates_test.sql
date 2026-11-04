-- Standalone TAP, Google place storage in Picks (0034). Fixtures roll back.
begin;
select '1..4';
insert into auth.users(id,raw_user_meta_data) values ('d0000001-2222-4222-8222-222222222222','{"display_name":"Host"}');
insert into public.picks(id,host_id,state,category,center_lat,center_lng,radius_m) values
 ('d0000010-2222-4222-8222-222222222222','d0000001-2222-4222-8222-222222222222','swiping','food',40.9,-73.1,1000),
 ('d0000011-2222-4222-8222-222222222222','d0000001-2222-4222-8222-222222222222','completed','food',40.9,-73.1,1000);
insert into public.places(id,name,category,lat,lng,raw) values
 ('gplace','Secret Name','food',40.9,-73.1,'{"provider":"google","name":"Secret Name","category":"food","address":"1 Main St"}');
do $$ begin
 if exists(select 1 from public.places where id='gplace' and (name<>'gplace' or lat<>0 or lng<>0 or source<>'google' or raw::text like '%Secret%' or raw::text like '%Main%')) then raise exception 'Google content stored in places'; end if;
end $$;
select 'ok 1 - places keeps only the ID and category of a Google place';
insert into public.pick_candidates(pick_id,place_id,snapshot,created_at) values
 ('d0000010-2222-4222-8222-222222222222','gplace','{"placeId":"gplace","name":null,"category":"food","lat":40.9,"lng":-73.1,"provider":"google"}',now()-interval '40 days'),
 ('d0000011-2222-4222-8222-222222222222','gplace','{"placeId":"gplace","name":null,"category":"food","lat":40.9,"lng":-73.1,"provider":"google"}',now()-interval '40 days');
do $$ begin
 begin
  update public.pick_candidates set snapshot=snapshot-'lat'-'lng'||'{"provider":"mock"}' where pick_id='d0000011-2222-4222-8222-222222222222';
  raise exception 'Mock snapshot lost coordinates';
 exception when check_violation then null; end;
end $$;
select 'ok 2 - only Google snapshots may lack coordinates';
set local role service_role;
do $$ begin
 if public.purge_google_coordinates(now()-interval '29 days')<>2 then raise exception 'Wrong purge count'; end if;
end $$;
reset role;
do $$ begin
 if exists(select 1 from public.pick_candidates where place_id='gplace' and (snapshot ? 'lat' or snapshot ? 'lng')) then raise exception 'Coordinates kept'; end if;
 if (select state from public.picks where id='d0000010-2222-4222-8222-222222222222')<>'canceled' then raise exception 'Open Pick not canceled'; end if;
 if (select state from public.picks where id='d0000011-2222-4222-8222-222222222222')<>'completed' then raise exception 'Finished Pick changed'; end if;
end $$;
select 'ok 3 - coordinates older than the cutoff go, and open Picks are canceled';
do $$ begin
 if has_function_privilege('authenticated','public.purge_google_coordinates(timestamptz)','execute') then raise exception 'Clients can purge'; end if;
end $$;
select 'ok 4 - clients cannot run the purge';
rollback;
