begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,raw_user_meta_data)
select ('a3000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'suggest'||n||'@example.invalid',jsonb_build_object('display_name','Friend '||n) from generate_series(1,6)n;
create function pg_temp.scheduled(minutes integer default 60) returns uuid language plpgsql as $$
declare p uuid; token uuid; begin
 p:=(public.pick_create_options('a3000000-0000-4000-8000-000000000001',jsonb_build_object('category','food','center',jsonb_build_object('lat',40,'lng',-73),'radiusM',3000,'poolSize',10,'closeThreshold',100,'deadlineAt',null,'proposedAt',now()+interval '2 days','swipeDeadlineMinutes',minutes))->>'id')::uuid;
 token:=(public.pick_availability_claim(p::text,'a3000000-0000-4000-8000-000000000001')->>'token')::uuid;
 perform public.pick_availability_finish(p::text,'a3000000-0000-4000-8000-000000000001',token,'[{"placeId":"av-cafe-a","snapshot":{"name":"Cafe A","lat":40,"lng":-73}},{"placeId":"av-cafe-b","snapshot":{"name":"Cafe B","lat":40,"lng":-73}}]');
 return p;
end $$;

create function pg_temp.completed_scheduled() returns uuid language plpgsql as $$ declare p uuid; begin
 p:=pg_temp.scheduled();
 insert into pick_participants(pick_id,user_id) select p,('a3000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(2,4)n;
 perform public.pick_availability_respond(p::text,'a3000000-0000-4000-8000-000000000002',1,'yes');
 perform public.heartbeat_upsert_swipe(p::text,'a3000000-0000-4000-8000-000000000001','av-cafe-a',2);
 perform public.pick_close_apply(p::text,'host','a3000000-0000-4000-8000-000000000001',(select version::text from picks where id=p),jsonb_build_object('state','final_vote','winnerPlaceId',null,'voteDeadlineAt',now()+interval '30 minutes','rows','[{"place_id":"av-cafe-a","rank":1,"score":80,"finalist":true},{"place_id":"av-cafe-b","rank":2,"score":70,"finalist":true}]'::jsonb));
 perform public.pick_cast_vote(p::text,'a3000000-0000-4000-8000-000000000001','av-cafe-a');
 perform public.pick_close_vote_apply(p::text,'av-cafe-a','vote');
 return p;
end $$;
create temp table schedule_fixture(id uuid, revision integer, suggestion uuid);
insert into schedule_fixture(id) values(pg_temp.completed_scheduled());
update schedule_fixture set revision=(select schedule_revision from picks where id=schedule_fixture.id);
select public.pick_rsvp(id::text,'a3000000-0000-4000-8000-000000000002','going') from schedule_fixture;
select ok((public.pick_plan_load((select id::text from schedule_fixture),'a3000000-0000-4000-8000-000000000002')->>'timeSuggestionsAllowed')::boolean,'completed scheduled Pick exposes suggestions');
update schedule_fixture set suggestion=(public.pick_time_suggest(id::text,'a3000000-0000-4000-8000-000000000002',revision,now()+interval '3 days')->>'id')::uuid;
select is((select plan_at=proposed_at from picks where id=(select id from schedule_fixture)),true,'suggestion does not change canonical plan');
select is((public.pick_time_suggest(id::text,'a3000000-0000-4000-8000-000000000002',revision,now()+interval '3 days')->>'id')::uuid,suggestion,'duplicate submit returns same proposal') from schedule_fixture;
select is((public.pick_time_suggest(id::text,'a3000000-0000-4000-8000-000000000003',revision,now()+interval '3 days')->>'id')::uuid,suggestion,'two users suggesting the same instant share one proposal') from schedule_fixture;
select is((select count(*) from pick_time_suggestions where pick_id=(select id from schedule_fixture)),1::bigint,'no duplicate proposal rows');
select throws_ok($$select public.pick_time_suggest(id::text,'a3000000-0000-4000-8000-000000000005',revision,now()+interval '3 days') from schedule_fixture$$,'PT404','Pick not found','stranger cannot suggest');
select throws_ok($$select public.pick_time_suggest(id::text,'a3000000-0000-4000-8000-000000000002',revision-1,now()+interval '3 days') from schedule_fixture$$,'PT409','Schedule changed. Refresh before suggesting a time.','stale suggestion revision rejected');
select throws_ok($$select public.pick_time_suggest(id::text,'a3000000-0000-4000-8000-000000000002',revision,now()-interval '1 second') from schedule_fixture$$,'PT400','Choose a different future time within 30 days','past time rejected');
select throws_ok($$select public.pick_time_suggestion_act(id::text,'a3000000-0000-4000-8000-000000000003',suggestion,revision,'accept') from schedule_fixture$$,'PT403','Host only','nonhost cannot accept');
select throws_ok($$select public.pick_time_suggestion_act(id::text,'a3000000-0000-4000-8000-000000000003',suggestion,revision,'withdraw') from schedule_fixture$$,'PT403','Only the proposer can withdraw','cannot withdraw someone else proposal');
select is((select count(*) from public.notify_insert(array['a3000000-0000-4000-8000-000000000001']::uuid[],'time_suggested',(select id from schedule_fixture),jsonb_build_object('timeSuggestionId',(select suggestion from schedule_fixture)))),1::bigint,'host receives suggestion notice');
select is((select count(*) from public.notify_insert(array['a3000000-0000-4000-8000-000000000001']::uuid[],'time_suggested',(select id from schedule_fixture),jsonb_build_object('timeSuggestionId',(select suggestion from schedule_fixture)))),0::bigint,'suggestion notice deduplicates');
select lives_ok($$select public.pick_time_suggestion_act(id::text,'a3000000-0000-4000-8000-000000000001',suggestion,revision,'accept') from schedule_fixture$$,'host accepts via canonical scheduling');
select is((select plan_at from picks where id=(select id from schedule_fixture)),now()+interval '3 days','acceptance updates plan time');
select is((select schedule_revision from picks where id=(select id from schedule_fixture)),(select revision+1 from schedule_fixture),'acceptance increments schedule revision');
select is((select status from pick_time_suggestions where id=(select suggestion from schedule_fixture)),'accepted','accepted status persisted');
select is((select count(*) from pick_rsvps where pick_id=(select id from schedule_fixture)),0::bigint,'final RSVPs must reconfirm');
select throws_ok($$select public.pick_rsvp(id::text,'a3000000-0000-4000-8000-000000000002','going') from schedule_fixture$$,'PT409','The plan time changed. Update WTW and RSVP again.','legacy unversioned RSVP cannot bypass reconfirmation after rescheduling');
select throws_ok($$select public.pick_rsvp(id::text,'a3000000-0000-4000-8000-000000000002','going',revision) from schedule_fixture$$,'PT409','The plan time changed. Refresh and RSVP again.','late old-time RSVP cannot reconfirm new time');
select lives_ok($$select public.pick_rsvp(id::text,'a3000000-0000-4000-8000-000000000002','going',revision+1) from schedule_fixture$$,'fresh schedule revision permits reconfirmation');
select is((select count(*) from pick_voting_cohort where pick_id=(select id from schedule_fixture)),2::bigint,'frozen decision cohort unchanged');
select is((select count(*) from preferences where pick_id=(select id from schedule_fixture)),1::bigint,'swipe history preserved');
select is((select count(*) from final_votes where pick_id=(select id from schedule_fixture)),1::bigint,'vote history preserved');
select is((select count(*) from ranking_results where pick_id=(select id from schedule_fixture)),2::bigint,'ranking preserved');
select is((select winner_place_id from picks where id=(select id from schedule_fixture)),'av-cafe-a','winner preserved');
select is((select proposed_at from picks where id=(select id from schedule_fixture)),now()+interval '2 days','original availability proposal preserved separately');
select is((select count(*) from pick_outcomes where pick_id=(select id from schedule_fixture)),0::bigint,'no attendance manufactured');
select lives_ok($$select public.pick_time_suggestion_act(id::text,'a3000000-0000-4000-8000-000000000001',suggestion,revision,'accept') from schedule_fixture$$,'ambiguous acceptance retry is idempotent');
select is((select count(*) from public.notify_insert(array['a3000000-0000-4000-8000-000000000002','a3000000-0000-4000-8000-000000000003']::uuid[],'plan_time_set',(select id from schedule_fixture),jsonb_build_object('timeSuggestionId',(select suggestion from schedule_fixture)))),2::bigint,'authorized participants receive reconfirmation notice');
select is((select count(*) from public.notify_insert(array['a3000000-0000-4000-8000-000000000002']::uuid[],'plan_time_set',(select id from schedule_fixture),jsonb_build_object('timeSuggestionId',(select suggestion from schedule_fixture)))),0::bigint,'acceptance notice retry deduplicates');
-- A subsequent direct reschedule invalidates old accept requests and notifications.
select public.pick_set_plan_time(id::text,'a3000000-0000-4000-8000-000000000001',now()+interval '4 days') from schedule_fixture;
select throws_ok($$select public.pick_time_suggestion_act(id::text,'a3000000-0000-4000-8000-000000000001',suggestion,revision,'accept') from schedule_fixture$$,'PT409','This suggestion is no longer current','old accepted suggestion cannot overwrite newer direct scheduling');
select is((select count(*) from public.notify_insert(array['a3000000-0000-4000-8000-000000000004']::uuid[],'plan_time_set',(select id from schedule_fixture),jsonb_build_object('timeSuggestionId',(select suggestion from schedule_fixture)))),0::bigint,'out-of-order notice ignored');
update schedule_fixture set revision=(select schedule_revision from picks where id=schedule_fixture.id),suggestion=null;
update schedule_fixture set suggestion=(public.pick_time_suggest(id::text,'a3000000-0000-4000-8000-000000000002',revision,now()+interval '5 days')->>'id')::uuid;
select public.pick_time_suggestion_act(id::text,'a3000000-0000-4000-8000-000000000002',suggestion,revision,'withdraw') from schedule_fixture;
select lives_ok($$select public.pick_time_suggestion_act(id::text,'a3000000-0000-4000-8000-000000000002',suggestion,revision,'withdraw') from schedule_fixture$$,'withdrawal retry safe');
select throws_ok($$select public.pick_time_suggestion_act(id::text,'a3000000-0000-4000-8000-000000000001',suggestion,revision,'accept') from schedule_fixture$$,'PT409','This suggestion is no longer current','withdrawn suggestion cannot be accepted');
select is((public.pick_time_suggest(id::text,'a3000000-0000-4000-8000-000000000002',revision,now()+interval '5 days')->>'id')::uuid,suggestion,'delayed duplicate submission cannot resurrect withdrawn proposal') from schedule_fixture;
-- Privacy/RLS: even completed Pick history does not authorize new scheduling after removal.
insert into groups(name,owner_id) values('Time test','a3000000-0000-4000-8000-000000000001');
insert into group_members(group_id,user_id,role) select id,'a3000000-0000-4000-8000-000000000001','owner' from groups where name='Time test';
insert into group_members(group_id,user_id) select id,'a3000000-0000-4000-8000-000000000002' from groups where name='Time test';
update picks set group_id=(select id from groups where name='Time test') where id=(select id from schedule_fixture);
select public.group_remove_member('a3000000-0000-4000-8000-000000000001',(select id from groups where name='Time test'),'a3000000-0000-4000-8000-000000000002');
select throws_ok($$select public.pick_time_suggestions_load(id::text,'a3000000-0000-4000-8000-000000000002') from schedule_fixture$$,'PT404','Pick not found','removed group member cannot read scheduling suggestions');
select throws_ok($$select public.pick_rsvp(id::text,'a3000000-0000-4000-8000-000000000002','going',revision) from schedule_fixture$$,'PT404','Pick not found','removed member cannot confirm the new schedule');
select throws_ok($$select public.pick_time_suggest(id::text,'a3000000-0000-4000-8000-000000000002',revision,now()+interval '6 days') from schedule_fixture$$,'PT404','Pick not found','removed group member cannot suggest');
select throws_ok($$select public.pick_time_suggestion_act(id::text,'a3000000-0000-4000-8000-000000000001',suggestion,revision,'accept') from schedule_fixture$$,'PT404','Suggestion not found','host cannot accept a revoked proposer suggestion');
select set_config('request.jwt.claim.sub','a3000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select is((select count(*) from pick_time_suggestions),0::bigint,'RLS clears removed member suggestion projection');
select ok(not has_table_privilege('authenticated','public.pick_time_suggestions','insert'),'clients cannot write suggestion table');
select ok(not has_function_privilege('authenticated','public.pick_time_suggest(text,uuid,integer,timestamptz)','execute'),'clients cannot spoof RPC actor');
reset role;
select public.group_delete('a3000000-0000-4000-8000-000000000001',(select id from groups where name='Time test'));
select throws_ok($$select public.pick_time_suggestions_load(id::text,'a3000000-0000-4000-8000-000000000002') from schedule_fixture$$,'PT404','Pick not found','group deletion does not revive removed-member scheduling permission');
-- Ordinary Picks retain host rescheduling and never advertise suggestions.
create temp table ordinary(id uuid);
insert into ordinary values(pg_temp.completed_scheduled());
update picks set proposed_at=null,availability_revision=0,availability_locked_at=null,swipe_deadline_minutes=null where id=(select id from ordinary);
select ok(not coalesce((public.pick_plan_load((select id::text from ordinary),'a3000000-0000-4000-8000-000000000001')->>'timeSuggestionsAllowed')::boolean,false),'ordinary Pick has no suggestion control');
select lives_ok($$select public.pick_set_plan_time(id::text,'a3000000-0000-4000-8000-000000000001',now()+interval '6 days') from ordinary$$,'ordinary host rescheduling works');
select throws_ok($$select public.pick_time_suggestions_load(id::text,'a3000000-0000-4000-8000-000000000001') from ordinary$$,'PT404','Pick not found','ordinary suggestion API fails closed');
-- Legacy group-less history cannot prove whether a removed group once owned it.
create temp table legacy(id uuid);
insert into legacy values(pg_temp.completed_scheduled());
update picks set suggestion_group_required=null where id=(select id from legacy);
select throws_ok($$select public.pick_time_suggestions_load(id::text,'a3000000-0000-4000-8000-000000000001') from legacy$$,'PT404','Pick not found','unknown legacy group provenance fails closed for suggestions');
select lives_ok($$select public.pick_set_plan_time(id::text,'a3000000-0000-4000-8000-000000000001',now()+interval '7 days') from legacy$$,'legacy direct host scheduling is preserved');
select lives_ok($$select public.pick_rsvp(id::text,'a3000000-0000-4000-8000-000000000002','going',(select schedule_revision from picks where id=legacy.id)) from legacy$$,'legacy plan participants can still confirm the displayed schedule');
-- Canceled or active Picks cannot be used through direct RPC calls.
update picks set state='canceled' where id=(select id from schedule_fixture);
select throws_ok($$select public.pick_time_suggestions_load(id::text,'a3000000-0000-4000-8000-000000000001') from schedule_fixture$$,'PT404','Pick not found','canceled Pick rejects pending operations');
select * from finish();
rollback;
