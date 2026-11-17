begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,raw_user_meta_data)
select ('af000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'av'||n||'@example.invalid',jsonb_build_object('display_name','Friend '||n) from generate_series(1,6)n;
create function pg_temp.scheduled(minutes integer default 60) returns uuid language plpgsql as $$
declare p uuid; token uuid; begin
 p:=(public.pick_create_options('af000000-0000-4000-8000-000000000001',jsonb_build_object('category','food','center',jsonb_build_object('lat',40,'lng',-73),'radiusM',3000,'poolSize',10,'closeThreshold',100,'deadlineAt',null,'proposedAt',now()+interval '2 days','swipeDeadlineMinutes',minutes))->>'id')::uuid;
 token:=(public.pick_availability_claim(p::text,'af000000-0000-4000-8000-000000000001')->>'token')::uuid;
 perform public.pick_availability_finish(p::text,'af000000-0000-4000-8000-000000000001',token,'[{"placeId":"av-cafe-a","snapshot":{"name":"Cafe A","lat":40,"lng":-73}},{"placeId":"av-cafe-b","snapshot":{"name":"Cafe B","lat":40,"lng":-73}}]');
 return p;
end $$;

create function pg_temp.emptyable(minutes integer default 60) returns uuid language plpgsql as $$
declare p uuid; begin
 p:=pg_temp.scheduled(minutes);
 insert into pick_participants(pick_id,user_id) values(p,'af000000-0000-4000-8000-000000000003');
 perform public.pick_availability_respond(p::text,'af000000-0000-4000-8000-000000000003',1,'yes');
 perform public.pick_availability_respond(p::text,'af000000-0000-4000-8000-000000000001',1,'cant');
 return p;
end $$;
create temp table empty_round(id uuid,group_id uuid);
insert into empty_round(id) values(pg_temp.emptyable());
insert into groups(name,owner_id) values('Empty round regression','af000000-0000-4000-8000-000000000001');
update empty_round set group_id=(select id from groups where name='Empty round regression');
insert into group_members(group_id,user_id,role) select group_id,'af000000-0000-4000-8000-000000000001','owner' from empty_round;
insert into group_members(group_id,user_id) select group_id,'af000000-0000-4000-8000-000000000003' from empty_round;
update picks set group_id=empty_round.group_id from empty_round where picks.id=empty_round.id;
select is((select state::text from picks where id=(select id from empty_round)),'swiping','host Cant and friend Yes remain active');
select public.group_remove_member('af000000-0000-4000-8000-000000000001',group_id,'af000000-0000-4000-8000-000000000003') from empty_round;
select is((select state::text from picks where id=(select id from empty_round)),'canceled','exact regression: removing sole eligible group member cancels round immediately');
select is((select cancel_reason from picks where id=(select id from empty_round)),'No eligible participants remain in this Pick.','cancellation persists an explanation');
update picks set deadline_at=now()-interval '1 second' where id=(select id from empty_round);
select is((select state::text from picks where id=(select id from empty_round)),'canceled','round cannot be stranded after deadline');
select is((select winner_place_id from picks where id=(select id from empty_round)),null::text,'no winner invented');
select is((select count(*) from pick_voting_cohort where pick_id=(select id from empty_round)),0::bigint,'no final cohort created');
select is((select count(*) from final_votes where pick_id=(select id from empty_round)),0::bigint,'no final vote created');
select lives_ok($$select public.group_remove_member('af000000-0000-4000-8000-000000000001',group_id,'af000000-0000-4000-8000-000000000003') from empty_round$$,'removal retry is idempotent');
select throws_ok($$select public.pick_close_apply(id::text,'system',null,(select version::text from picks where id=empty_round.id),'{}') from empty_round$$,'PT409','Pick changed; reload before trying again','stale automatic close cannot revive cancellation');
select throws_ok($$select public.pick_close_apply(id::text,'host','af000000-0000-4000-8000-000000000001',(select version::text from picks where id=empty_round.id),'{}') from empty_round$$,'PT409','Pick changed; reload before trying again','stale manual close cannot revive cancellation');
select is((select count(*) from ranking_results where pick_id=(select id from empty_round)),0::bigint,'cancellation and closure retries never persist ranking');
select throws_ok($$select public.pick_availability_respond(id::text,'af000000-0000-4000-8000-000000000001',1,'yes') from empty_round$$,'PT409','The swipe round has closed; refresh this Pick','pending response cannot revive canceled round');
create temp table no_deadline(id uuid);
insert into no_deadline values(pg_temp.emptyable(0));
delete from pick_participants where pick_id=(select id from no_deadline) and user_id='af000000-0000-4000-8000-000000000003';
select is((select state::text from picks where id=(select id from no_deadline)),'canceled','No deadline rounds also recover on direct roster removal');
create temp table blocked_round(id uuid);
insert into blocked_round values(pg_temp.emptyable());
insert into blocks(blocker_id,blocked_id) values('af000000-0000-4000-8000-000000000001','af000000-0000-4000-8000-000000000003');
select is((select state::text from picks where id=(select id from blocked_round)),'canceled','blocking sole eligible friend also cancels');
delete from blocks where blocker_id='af000000-0000-4000-8000-000000000001';
create temp table remaining(id uuid);
insert into remaining values(pg_temp.scheduled());
insert into pick_participants(pick_id,user_id) select id,'af000000-0000-4000-8000-000000000003' from remaining;
delete from pick_participants where pick_id=(select id from remaining) and user_id='af000000-0000-4000-8000-000000000003';
select is((select state::text from picks where id=(select id from remaining)),'swiping','remaining eligible host keeps round open');
update picks set proposed_at=null,availability_revision=0,swipe_deadline_minutes=null where id=(select id from remaining);
delete from pick_participants where pick_id=(select id from remaining);
select is((select state::text from picks where id=(select id from remaining)),'swiping','ordinary unscheduled lifecycle unchanged');
select ok(not has_function_privilege('authenticated','private.cancel_empty_scheduled_round()','execute'),'trigger cannot be called by authenticated clients');
create temp table ended(id uuid);
insert into ended values(pg_temp.emptyable());
-- Completed history is deliberately retained even after roster changes.
update picks set state='completed',winner_place_id='av-cafe-a',decided_at=now(),decided_by='clear_winner' where id=(select id from ended);
delete from pick_participants where pick_id=(select id from ended) and user_id='af000000-0000-4000-8000-000000000003';
select is((select state::text from picks where id=(select id from ended)),'completed','completed Picks are never canceled by the recovery trigger');
select is((select winner_place_id from picks where id=(select id from ended)),'av-cafe-a','completed winner is preserved');
create temp table canceled_before(id uuid);
insert into canceled_before values(pg_temp.emptyable());
select public.pick_cancel(id::text,'af000000-0000-4000-8000-000000000001','Host canceled') from canceled_before;
delete from pick_participants where pick_id=(select id from canceled_before) and user_id='af000000-0000-4000-8000-000000000003';
select is((select cancel_reason from picks where id=(select id from canceled_before)),'Host canceled','existing cancellation reason is preserved');
select * from finish();
rollback;
