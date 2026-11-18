begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,raw_user_meta_data) values
 ('af000000-0000-4000-8000-000000000001','generation-host@example.invalid','{"display_name":"Generation host"}'),
 ('af000000-0000-4000-8000-000000000002','generation-guest@example.invalid','{"display_name":"Generation guest"}');
create temp table generation_case as select
 (public.pick_create('af000000-0000-4000-8000-000000000001','food',40,-73,3000,10,null,100)->>'id')::uuid as id;
insert into pick_participants(pick_id,user_id) select id,'af000000-0000-4000-8000-000000000002' from generation_case;
select public.pick_start(id::text,'af000000-0000-4000-8000-000000000001',
 '[{"placeId":"generation-a","snapshot":{"name":"Old","lat":40,"lng":-73,"provider":"mock","tasteType":"cafe"},"tasteScore":0.9}]') from generation_case;
create temp table before_generation as select c.taste_generation,c.created_at from pick_candidates c join generation_case f on f.id=c.pick_id;
create function pg_temp.score_delete_failure() returns trigger language plpgsql as $$ begin raise exception 'Optional cleanup unavailable'; end $$;
create trigger generation_delete_failure before delete on private.pick_candidate_taste for each row execute function pg_temp.score_delete_failure();
select lives_ok($$select public.pick_refresh(id::text,'af000000-0000-4000-8000-000000000001',
 '[{"placeId":"generation-a","snapshot":{"name":"Replacement","lat":40,"lng":-73,"provider":"mock","tasteType":"cafe"}}]') from generation_case$$,
 'same-transaction refresh succeeds despite optional cleanup failure');
drop trigger generation_delete_failure on private.pick_candidate_taste;
select is((select c.created_at from pick_candidates c join generation_case f on f.id=c.pick_id),(select created_at from before_generation),'regression really shares a transaction timestamp');
select isnt((select c.taste_generation from pick_candidates c join generation_case f on f.id=c.pick_id),(select taste_generation from before_generation),'replacement uses a different UUID generation');
select is((public.pick_load_for_close((select id::text from generation_case))->'candidates'->0->>'tasteScore'),'0','old 0.9 cannot influence replacement ranking');
select is((select count(*) from private.pick_candidate_taste where pick_id=(select id from generation_case)),1::bigint,'failed optional cleanup leaves a row for the sweep');
select public.purge_google_coordinates(now()-interval '30 days');
select is((select count(*) from private.pick_candidate_taste where pick_id=(select id from generation_case)),0::bigint,'sweep deletes stale generation while Pick is active');
select is((select state::text from picks where id=(select id from generation_case)),'swiping','orphan sweep preserves active Pick');
select ok((select deadline_at is null from picks where id=(select id from generation_case)),'No-deadline Pick is covered');
select public.purge_google_coordinates(now()-interval '30 days');
select is((select count(*) from private.pick_candidate_taste where pick_id=(select id from generation_case)),0::bigint,'repeat sweep is idempotent');
select public.heartbeat_upsert_swipe(id::text,'af000000-0000-4000-8000-000000000002','generation-a',2) from generation_case;
select is((select score from learned_taste where user_id='af000000-0000-4000-8000-000000000002' and place_type='cafe'),1::real,'owned non-Google learning remains functional');
select throws_ok($$select public.pick_refresh(id::text,'af000000-0000-4000-8000-000000000002','[]') from generation_case$$,'PT403',null,'optional isolation never swallows canonical host authorization');
-- A mixed-version server cannot persist Google classifications or numeric taste scores.
create temp table google_case as select
 (public.pick_create('af000000-0000-4000-8000-000000000001','food',40,-73,3000,10,null,100)->>'id')::uuid as id;
insert into pick_participants(pick_id,user_id) select id,'af000000-0000-4000-8000-000000000002' from google_case;
select public.pick_start(id::text,'af000000-0000-4000-8000-000000000001',
 '[{"placeId":"generation-google-a","snapshot":{"name":null,"lat":40,"lng":-73,"provider":"google","tasteType":"cafe"},"tasteScore":1},
   {"placeId":"generation-google-b","snapshot":{"name":null,"lat":40,"lng":-73,"provider":"google","tasteType":"museum"},"tasteScore":-1}]') from google_case;
select ok(not exists(select 1 from pick_candidates c join google_case f on f.id=c.pick_id where snapshot ? 'tasteType'),'database strips Google tasteType even from old-server payloads');
select is((select count(*) from private.pick_candidate_taste where pick_id=(select id from google_case)),0::bigint,'database refuses persisted Google-derived numeric scores');
select public.heartbeat_upsert_swipe(id::text,'af000000-0000-4000-8000-000000000001','generation-google-a',2) from google_case;
select public.pick_close_apply(id::text,'host','af000000-0000-4000-8000-000000000001',
 (select version::text from picks where id=google_case.id),
 jsonb_build_object('state','final_vote','winnerPlaceId',null,'voteDeadlineAt',now()+interval '30 minutes','rows',
 '[{"place_id":"generation-google-a","rank":1,"score":80,"finalist":true},{"place_id":"generation-google-b","rank":2,"score":70,"finalist":true}]'::jsonb)) from google_case;
select public.pick_cast_vote(id::text,'af000000-0000-4000-8000-000000000001','generation-google-a') from google_case;
select public.pick_close_vote_apply(id::text,'generation-google-a','vote') from google_case;
select is((select count(*) from taste_signals t cross join google_case f where t.source in(
 private.taste_source('swipe',f.id,'generation-google-a'),private.taste_source('vote',f.id,null),private.taste_source('winner',f.id,null))),0::bigint,'Google swipes, votes and winners never teach');
select is((select winner_place_id from picks where id=(select id from google_case)),'generation-google-a','Google persistence restriction preserves canonical winner');
select * from finish();
rollback;
