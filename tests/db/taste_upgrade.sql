-- Run via taste_upgrade.py against an empty disposable local database.
begin;
set local search_path=public;
create function pg_temp.check_that(value boolean,label text) returns void language plpgsql as $$ begin
 if value is distinct from true then raise exception 'Taste upgrade assertion failed: %',label; end if;
 raise notice 'PASS: %',label;
end $$;
select pg_temp.check_that(not exists(select 1 from information_schema.columns where table_schema='public' and table_name='pick_candidates' and column_name='taste_generation'),'fixture is at actual pre-0049 schema');
insert into auth.users(id,email,raw_user_meta_data) values
 ('a9000000-0000-4000-8000-000000000001','taste-upgrade-host@example.invalid','{"display_name":"Taste upgrade host"}'),
 ('a9000000-0000-4000-8000-000000000002','taste-upgrade-guest@example.invalid','{"display_name":"Taste upgrade guest"}');
create temp table taste_upgrade_case as select
 (public.pick_create('a9000000-0000-4000-8000-000000000001','food',40,-73,3000,10,null,100)->>'id')::uuid as id;
insert into pick_participants(pick_id,user_id) select id,'a9000000-0000-4000-8000-000000000002' from taste_upgrade_case;
select public.pick_start(id::text,'a9000000-0000-4000-8000-000000000001',
 '[{"placeId":"upgrade-owned","snapshot":{"name":"Owned","lat":40,"lng":-73,"provider":"mock","tasteType":"museum"},"tasteScore":0.4},
   {"placeId":"upgrade-google","snapshot":{"name":null,"lat":40,"lng":-73,"provider":"google","tasteType":"cafe"},"tasteScore":0.9}]') from taste_upgrade_case;
select public.heartbeat_upsert_swipe(id::text,'a9000000-0000-4000-8000-000000000001','upgrade-owned',2) from taste_upgrade_case;
select public.heartbeat_upsert_swipe(id::text,'a9000000-0000-4000-8000-000000000001','upgrade-google',2) from taste_upgrade_case;
insert into public.taste_signals(user_id,source,place_type,weight) values('a9000000-0000-4000-8000-000000000001',gen_random_uuid(),'park',1);
-- Reused hashes alone are not provenance: replace a stale legacy label from owned evidence.
update taste_signals set place_type='legacy_google_type' where source=private.taste_source('swipe',(select id from taste_upgrade_case),'upgrade-owned');
select pg_temp.check_that((select count(*) from private.pick_candidate_taste where pick_id=(select id from taste_upgrade_case))=2,'legacy numeric cache really exists');
select pg_temp.check_that((select count(*) from taste_signals where user_id='a9000000-0000-4000-8000-000000000001')=3,'legacy owned, Google and unprovable signals really exist');
create temp table before_taste_pick as select to_jsonb(p)-'version'-'updated_at' as value from picks p where id=(select id from taste_upgrade_case);
create temp table before_taste_swipes as select * from preferences where pick_id=(select id from taste_upgrade_case);
\if :{?legacy_cache_schema}
alter table private.pick_candidate_taste drop column candidate_created_at;
alter table private.pick_candidate_taste add constraint legacy_cache_fk foreign key(pick_id,place_id) references public.pick_candidates(pick_id,place_id) on delete cascade;
create or replace view public.learned_taste with (security_invoker=true) as
 select user_id,place_type,greatest(-10,least(10,sum(weight*power(0.5,extract(epoch from latest-at)/(30*86400.0)))))::real as score,latest as updated_at
 from (select *,max(at) over(partition by user_id,place_type) as latest from public.taste_signals) s group by user_id,place_type,latest;
\endif
\ir ../../supabase/migrations/0049_taste_generation_and_privacy.sql
select pg_temp.check_that((select to_jsonb(p)-'version'-'updated_at' from picks p where id=(select id from taste_upgrade_case))=(select value from before_taste_pick),'core Pick state, schedule and history are preserved');
select pg_temp.check_that(not exists((select * from preferences where pick_id=(select id from taste_upgrade_case) except all select * from before_taste_swipes) union all (select * from before_taste_swipes except all select * from preferences where pick_id=(select id from taste_upgrade_case))),'canonical swipe records are preserved');
select pg_temp.check_that(not exists(select 1 from pick_candidates where taste_generation is null),'existing candidates receive UUID generations');
select pg_temp.check_that(not exists(select 1 from private.pick_candidate_taste),'untrustworthy legacy numeric cache is discarded');
select pg_temp.check_that(not exists(select 1 from pick_candidates where snapshot->>'provider'='google' and snapshot ? 'tasteType'),'legacy Google classifications are stripped');
select pg_temp.check_that((select count(*) from taste_signals where user_id='a9000000-0000-4000-8000-000000000001')=1,'Google and unverifiable historical learning is removed');
select pg_temp.check_that((select place_type from taste_signals where user_id='a9000000-0000-4000-8000-000000000001')='museum','owned learning is rebuilt from independent current evidence, not a stale legacy label');
select pg_temp.check_that((public.pick_load_for_close((select id::text from taste_upgrade_case))->>'state')='swiping','existing active Pick remains usable without cached scores');
select pg_temp.check_that(not has_function_privilege('authenticated','private.purge_candidate_taste()','execute'),'new purge helper is not exposed to clients');
select pg_temp.check_that(not exists(select 1 from pg_catalog.pg_constraint where conrelid='private.pick_candidate_taste'::regclass and contype='f'),'legacy blocking cache foreign keys are removed');
insert into taste_signals(user_id,source,place_type,weight,at)
 select 'a9000000-0000-4000-8000-000000000002',gen_random_uuid(),'zoo',1,now()-interval '60 days' from generate_series(1,20);
select pg_temp.check_that((select score from learned_taste where user_id='a9000000-0000-4000-8000-000000000002' and place_type='zoo')=20,'legacy pre-decay clamp is upgraded to the uncapped aggregate');
rollback;
