-- Run through time_suggestions_upgrade.py against a disposable PRE-0046 database.
-- Fixture and upgrade assertions roll back together; repository migrations are unmodified.
begin;
set local search_path=public;
create function pg_temp.check_that(value boolean, label text) returns void language plpgsql as $$ begin
 if value is distinct from true then raise exception 'Upgrade assertion failed: %',label; end if;
 raise notice 'PASS: %',label;
end $$;
select pg_temp.check_that(not exists(select 1 from information_schema.columns where table_schema='public' and table_name='picks' and column_name='schedule_revision'),'exact pre-0046 schema');
insert into auth.users(id,email,raw_user_meta_data)
select ('a5000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'upgrade'||n||'@example.invalid',jsonb_build_object('display_name','Upgrade '||n) from generate_series(1,4)n;
create function pg_temp.scheduled(minutes integer default 60) returns uuid language plpgsql as $$
declare p uuid; token uuid; begin
 p:=(public.pick_create_options('a5000000-0000-4000-8000-000000000001',jsonb_build_object('category','food','center',jsonb_build_object('lat',40,'lng',-73),'radiusM',3000,'poolSize',10,'closeThreshold',100,'deadlineAt',null,'proposedAt',now()+interval '2 days','swipeDeadlineMinutes',minutes))->>'id')::uuid;
 token:=(public.pick_availability_claim(p::text,'a5000000-0000-4000-8000-000000000001')->>'token')::uuid;
 perform public.pick_availability_finish(p::text,'a5000000-0000-4000-8000-000000000001',token,'[{"placeId":"av-cafe-a","snapshot":{"name":"Cafe A","lat":40,"lng":-73}},{"placeId":"av-cafe-b","snapshot":{"name":"Cafe B","lat":40,"lng":-73}}]');
 return p;
end $$;

create function pg_temp.completed_scheduled() returns uuid language plpgsql as $$ declare p uuid; begin
 p:=pg_temp.scheduled();
 insert into pick_participants(pick_id,user_id) select p,('a5000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(2,4)n;
 perform public.pick_availability_respond(p::text,'a5000000-0000-4000-8000-000000000002',1,'yes');
 perform public.heartbeat_upsert_swipe(p::text,'a5000000-0000-4000-8000-000000000001','av-cafe-a',2);
 perform public.heartbeat_upsert_swipe(p::text,'a5000000-0000-4000-8000-000000000002','av-cafe-a',2);
 perform public.pick_close_apply(p::text,'host','a5000000-0000-4000-8000-000000000001',(select version::text from picks where id=p),jsonb_build_object('state','final_vote','winnerPlaceId',null,'voteDeadlineAt',now()+interval '30 minutes','rows','[{"place_id":"av-cafe-a","rank":1,"score":80,"finalist":true},{"place_id":"av-cafe-b","rank":2,"score":70,"finalist":true}]'::jsonb));
 perform public.pick_cast_vote(p::text,'a5000000-0000-4000-8000-000000000001','av-cafe-a');
 perform public.pick_cast_vote(p::text,'a5000000-0000-4000-8000-000000000002','av-cafe-a');
 perform public.pick_close_vote_apply(p::text,'av-cafe-a','vote');
 return p;
end $$;

create temp table upgrade_picks(kind text primary key,id uuid);
insert into upgrade_picks values ('hostless',pg_temp.completed_scheduled()),('grouped',pg_temp.completed_scheduled()),('legacy-nongroup',pg_temp.completed_scheduled());
insert into groups(id,name,owner_id) values('a5000000-0000-4000-8000-000000000010','Upgrade group','a5000000-0000-4000-8000-000000000004');
insert into group_members(group_id,user_id,role) select 'a5000000-0000-4000-8000-000000000010',('a5000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,case when n=4 then 'owner' else 'member' end from generate_series(1,4)n;
update picks set group_id='a5000000-0000-4000-8000-000000000010' where id in(select id from upgrade_picks where kind in ('hostless','grouped'));
-- Other fixture Picks survive as hosted records when account 1 is deleted.
update picks set host_id='a5000000-0000-4000-8000-000000000002' where id in(select id from upgrade_picks where kind<>'hostless');
select public.pick_rsvp(id::text,'a5000000-0000-4000-8000-000000000002','going') from upgrade_picks;
insert into pick_outcomes(pick_id,user_id,went,again) select id,'a5000000-0000-4000-8000-000000000002',true,true from upgrade_picks;
-- This is the supported DELETE /me storage operation, not an invented hostless row.
delete from auth.users where id='a5000000-0000-4000-8000-000000000001';
select pg_temp.check_that(exists(select 1 from picks where id=(select id from upgrade_picks where kind='hostless') and host_id is null and group_id is not null and state='completed'),'supported host deletion preserves grouped history');
select pg_temp.check_that((select count(*) from final_votes where pick_id in (select id from upgrade_picks))=3,'surviving vote history fixture is nonempty');
select pg_temp.check_that((select count(*) from preferences where pick_id in(select id from upgrade_picks))=3,'surviving swipe history fixture is nonempty');
select pg_temp.check_that((select count(*) from pick_outcomes where pick_id in(select id from upgrade_picks))=3,'attendance fixture is nonempty');
create temp table before_picks as select p.id,to_jsonb(p) as value from picks p join upgrade_picks f using(id);
create temp table before_related as
 select 'ranking' as kind,to_jsonb(r) as value from ranking_results r join upgrade_picks f on f.id=r.pick_id
 union all select 'swipes',to_jsonb(r) from preferences r join upgrade_picks f on f.id=r.pick_id
 union all select 'votes',to_jsonb(r) from final_votes r join upgrade_picks f on f.id=r.pick_id
 union all select 'availability',to_jsonb(r) from pick_availability r join upgrade_picks f on f.id=r.pick_id
 union all select 'cohort',to_jsonb(r) from pick_voting_cohort r join upgrade_picks f on f.id=r.pick_id
 union all select 'rsvp',to_jsonb(r) from pick_rsvps r join upgrade_picks f on f.id=r.pick_id
 union all select 'attendance',to_jsonb(r) from pick_outcomes r join upgrade_picks f on f.id=r.pick_id;
\ir ../../supabase/migrations/0046_post_result_time_suggestions.sql
select pg_temp.check_that((select to_jsonb(p)-'schedule_revision'-'suggestion_group_required' from picks p where id=(select id from upgrade_picks where kind='hostless'))=(select value from before_picks where id=(select id from upgrade_picks where kind='hostless')),'hostless Pick including version/timestamps is unchanged');
select pg_temp.check_that(not exists(select 1 from picks p join before_picks b using(id) where to_jsonb(p)-'schedule_revision'-'suggestion_group_required'-'version'-'updated_at'<>b.value-'version'-'updated_at'),'historical winner and schedule data are unchanged for all fixtures');
create temp table after_related as
 select 'ranking' as kind,to_jsonb(r) as value from ranking_results r join upgrade_picks f on f.id=r.pick_id
 union all select 'swipes',to_jsonb(r) from preferences r join upgrade_picks f on f.id=r.pick_id
 union all select 'votes',to_jsonb(r) from final_votes r join upgrade_picks f on f.id=r.pick_id
 union all select 'availability',to_jsonb(r) from pick_availability r join upgrade_picks f on f.id=r.pick_id
 union all select 'cohort',to_jsonb(r) from pick_voting_cohort r join upgrade_picks f on f.id=r.pick_id
 union all select 'rsvp',to_jsonb(r) from pick_rsvps r join upgrade_picks f on f.id=r.pick_id
 union all select 'attendance',to_jsonb(r) from pick_outcomes r join upgrade_picks f on f.id=r.pick_id;
select pg_temp.check_that(not exists((select * from before_related except all select * from after_related) union all (select * from after_related except all select * from before_related)),'ranking, swipes, votes, availability, cohort, RSVP and attendance preserved');
select pg_temp.check_that((select suggestion_group_required from picks where id=(select id from upgrade_picks where kind='grouped')) is true,'hosted group Pick receives provenance');
select pg_temp.check_that((select suggestion_group_required from picks where id=(select id from upgrade_picks where kind='hostless')) is null,'immutable hostless provenance remains unknown');
select pg_temp.check_that((select suggestion_group_required from picks where id=(select id from upgrade_picks where kind='legacy-nongroup')) is null,'ambiguous legacy nongroup provenance remains unknown');
select pg_temp.check_that(not exists(select 1 from picks p join upgrade_picks f using(id) where schedule_revision<>0),'initial schedule revision is zero');
select pg_temp.check_that(not coalesce((public.pick_plan_load((select id::text from upgrade_picks where kind='hostless'),'a5000000-0000-4000-8000-000000000002')->>'timeSuggestionsAllowed')::boolean,false),'hostless result remains readable without suggestion permission');
do $$ begin
 begin
  update picks set plan_at=now()+interval '9 days' where id=(select id from upgrade_picks where kind='hostless');
  raise exception 'Hostless guard was bypassed';
 exception when sqlstate 'PT409' then null; end;
 begin
  perform public.pick_time_suggestions_load((select id::text from upgrade_picks where kind='hostless'),'a5000000-0000-4000-8000-000000000002');
  raise exception 'Hostless scheduling was authorized';
 exception when sqlstate 'PT404' then null; end;
end $$;
select pg_temp.check_that(true,'hostless mutation guard and suggestion access restrictions remain effective');
select pg_temp.check_that((public.pick_plan_load((select id::text from upgrade_picks where kind='grouped'),'a5000000-0000-4000-8000-000000000002')->>'timeSuggestionsAllowed')::boolean,'hosted group Pick remains eligible');
-- New genuinely nongroup rows get explicit provenance, unlike ambiguous old history.
insert into upgrade_picks select 'modern-nongroup',(public.pick_create_options('a5000000-0000-4000-8000-000000000002',jsonb_build_object('category','food','center',jsonb_build_object('lat',40,'lng',-73),'radiusM',3000,'poolSize',10,'closeThreshold',100,'deadlineAt',null,'proposedAt',now()+interval '2 days','swipeDeadlineMinutes',60))->>'id')::uuid;
select pg_temp.check_that((select suggestion_group_required from picks where id=(select id from upgrade_picks where kind='modern-nongroup')) is false,'new nongroup Pick receives explicit safe provenance');
rollback;
