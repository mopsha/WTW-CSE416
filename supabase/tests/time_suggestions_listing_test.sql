begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,raw_user_meta_data)
select ('a6000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'listing'||n||'@example.invalid',jsonb_build_object('display_name','Listing '||n) from generate_series(1,54)n;
create function pg_temp.scheduled(minutes integer default 60) returns uuid language plpgsql as $$
declare p uuid; token uuid; begin
 p:=(public.pick_create_options('a6000000-0000-4000-8000-000000000001',jsonb_build_object('category','food','center',jsonb_build_object('lat',40,'lng',-73),'radiusM',3000,'poolSize',10,'closeThreshold',100,'deadlineAt',null,'proposedAt',now()+interval '2 days','swipeDeadlineMinutes',minutes))->>'id')::uuid;
 token:=(public.pick_availability_claim(p::text,'a6000000-0000-4000-8000-000000000001')->>'token')::uuid;
 perform public.pick_availability_finish(p::text,'a6000000-0000-4000-8000-000000000001',token,'[{"placeId":"av-cafe-a","snapshot":{"name":"Cafe A","lat":40,"lng":-73}},{"placeId":"av-cafe-b","snapshot":{"name":"Cafe B","lat":40,"lng":-73}}]');
 return p;
end $$;

create function pg_temp.completed_scheduled() returns uuid language plpgsql as $$ declare p uuid; begin
 p:=pg_temp.scheduled();
 insert into pick_participants(pick_id,user_id) select p,('a6000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(2,4)n;
 perform public.pick_availability_respond(p::text,'a6000000-0000-4000-8000-000000000002',1,'yes');
 perform public.heartbeat_upsert_swipe(p::text,'a6000000-0000-4000-8000-000000000001','av-cafe-a',2);
 perform public.pick_close_apply(p::text,'host','a6000000-0000-4000-8000-000000000001',(select version::text from picks where id=p),jsonb_build_object('state','final_vote','winnerPlaceId',null,'voteDeadlineAt',now()+interval '30 minutes','rows','[{"place_id":"av-cafe-a","rank":1,"score":80,"finalist":true},{"place_id":"av-cafe-b","rank":2,"score":70,"finalist":true}]'::jsonb));
 perform public.pick_cast_vote(p::text,'a6000000-0000-4000-8000-000000000001','av-cafe-a');
 perform public.pick_close_vote_apply(p::text,'av-cafe-a','vote');
 return p;
end $$;

create temp table listing_cases(id uuid, revision integer, original uuid);
insert into listing_cases(id) values(pg_temp.completed_scheduled()),(pg_temp.completed_scheduled());
update listing_cases set revision=(select schedule_revision from picks where id=listing_cases.id);
update listing_cases set original=(public.pick_time_suggest(id::text,'a6000000-0000-4000-8000-000000000002',revision,now()+interval '3 days')->>'id')::uuid;
-- Exact regression: B's 50 newer submissions must not hide A's older pending time.
do $$ declare c record; n integer; begin
 for c in select * from listing_cases loop
  for n in 1..50 loop
   perform public.pick_time_suggest(c.id::text,'a6000000-0000-4000-8000-000000000003',c.revision,now()+interval '4 days'+n*interval '1 minute');
  end loop;
 end loop;
end $$;
select ok(not exists(select 1 from listing_cases c where not exists(select 1 from jsonb_array_elements(public.pick_time_suggestions_load(c.id::text,'a6000000-0000-4000-8000-000000000001')->'suggestions') s where s->>'id'=c.original::text and s->>'status'='pending')),'older pending suggestions survive 50 newer proposals');
select is((select count(*) from jsonb_array_elements(public.pick_time_suggestions_load((select id::text from listing_cases limit 1),'a6000000-0000-4000-8000-000000000001')->'suggestions') s where s->>'status'='pending'),2::bigint,'multiple proposers remain actionable');
-- Exercise bounded history beyond 50 without dropping either pending proposal.
do $$ declare c record; n integer; begin
 for c in select * from listing_cases loop
  for n in 51..55 loop
   perform public.pick_time_suggest(c.id::text,'a6000000-0000-4000-8000-000000000003',c.revision,now()+interval '4 days'+n*interval '1 minute');
  end loop;
 end loop;
end $$;
create temp table listing_snapshot as select id,public.pick_time_suggestions_load(id::text,'a6000000-0000-4000-8000-000000000001')->'suggestions' as rows from listing_cases;
select ok(not exists(select 1 from listing_snapshot where jsonb_array_length(rows)<>52),'two pending plus at most 50 historical rows');
select ok(not exists(select 1 from listing_snapshot where rows<>public.pick_time_suggestions_load(id::text,'a6000000-0000-4000-8000-000000000001')->'suggestions'),'repeated loads have deterministic ordering');
select ok(not exists(select 1 from listing_snapshot where (select count(*) from jsonb_array_elements(rows))<>(select count(distinct s->>'id') from jsonb_array_elements(rows) s)),'pending and history have no duplicate IDs');
select ok(not exists(select 1 from listing_snapshot where (rows->0->>'status')<>'pending' or (rows->1->>'status')<>'pending' or (rows->2->>'status')='pending'),'pending rows precede bounded historical rows');
select is((public.pick_time_suggest(id::text,'a6000000-0000-4000-8000-000000000003',revision,now()+interval '4 days 55 minutes')->>'id'),(select rows->0->>'id' from listing_snapshot where listing_snapshot.id=listing_cases.id),'duplicate submission preserves existing ID') from listing_cases;
create temp table withdrawn_case as select * from listing_cases order by id limit 1;
select lives_ok($$select public.pick_time_suggestion_act(id::text,'a6000000-0000-4000-8000-000000000002',original,revision,'withdraw') from withdrawn_case$$,'owner can withdraw the older returned suggestion');
select throws_ok($$select public.pick_time_suggestion_act(id::text,'a6000000-0000-4000-8000-000000000001',original,revision,'accept') from withdrawn_case$$,'PT409','This suggestion is no longer current','withdrawn older proposal cannot be accepted');
select lives_ok($$select public.pick_time_suggestion_act(id::text,'a6000000-0000-4000-8000-000000000001',original,revision,'accept') from listing_cases where id not in(select id from withdrawn_case)$$,'host can accept the older pending suggestion despite newer history');
select is((select count(*) from jsonb_array_elements(public.pick_time_suggestions_load((select id::text from listing_cases where id not in(select id from withdrawn_case)),'a6000000-0000-4000-8000-000000000001')->'suggestions') s where s->>'status'='pending'),0::bigint,'no pending suggestions after acceptance');
select is(jsonb_array_length(public.pick_time_suggestions_load((select id::text from listing_cases where id not in(select id from withdrawn_case)),'a6000000-0000-4000-8000-000000000001')->'suggestions'),50,'history alone remains bounded');
-- Every pending proposal at the real 30-person roster cap is returned.
-- A >50-pending response is also exercised synthetically by the component test;
-- it cannot be constructed through production membership writes at this cap.
create temp table many_pending(id uuid, revision integer);
insert into many_pending(id) values(pg_temp.completed_scheduled());
insert into pick_participants(pick_id,user_id) select id,('a6000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from many_pending cross join generate_series(5,30)n;
update many_pending set revision=(select schedule_revision from picks where id=many_pending.id);
select public.pick_time_suggest(id::text,('a6000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,revision,now()+interval '5 days'+n*interval '1 minute') from many_pending cross join generate_series(2,30)n;
select is(jsonb_array_length(public.pick_time_suggestions_load((select id::text from many_pending),'a6000000-0000-4000-8000-000000000001')->'suggestions'),29,'every pending suggestion at the membership cap is returned');
select throws_ok($$select public.pick_time_suggestions_load((select id::text from many_pending),'a6000000-0000-4000-8000-000000000054')$$,'PT404','Pick not found','outsider cannot read the expanded listing');
insert into blocks(blocker_id,blocked_id) values('a6000000-0000-4000-8000-000000000003','a6000000-0000-4000-8000-000000000002');
select ok(not exists(select 1 from jsonb_array_elements(public.pick_time_suggestions_load((select id::text from many_pending),'a6000000-0000-4000-8000-000000000003')->'suggestions') s where s->>'proposerId'='a6000000-0000-4000-8000-000000000002'),'expanded listing still filters blocked proposers');
select set_config('request.jwt.claim.sub','a6000000-0000-4000-8000-000000000054',true);
set local role authenticated;
select is((select count(*) from pick_time_suggestions),0::bigint,'RLS still hides all suggestions from an unrelated user');
reset role;
update picks set state='canceled' where id=(select id from many_pending);
select throws_ok($$select public.pick_time_suggestions_load((select id::text from many_pending),'a6000000-0000-4000-8000-000000000001')$$,'PT404','Pick not found','canceled Pick listing rejects access');
select * from finish();
rollback;
