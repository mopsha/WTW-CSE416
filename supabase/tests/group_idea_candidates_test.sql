-- Standalone TAP, real lifecycle / RLS / snapshot persistence; fixtures roll back.
begin;
select '1..10';
insert into auth.users(id,raw_user_meta_data) select
 ('c'||repeat(i::text,7)||'-1111-4111-8111-111111111111')::uuid,'{}'::jsonb from generate_series(1,3) i;
insert into public.groups(id,name,owner_id) values
 ('c0000000-1111-4111-8111-111111111111','Crew','c1111111-1111-4111-8111-111111111111'),
 ('d0000000-1111-4111-8111-111111111111','Other crew','c1111111-1111-4111-8111-111111111111');
insert into public.group_members(group_id,user_id,role) select
 'c0000000-1111-4111-8111-111111111111',('c'||repeat(i::text,7)||'-1111-4111-8111-111111111111')::uuid,
 case when i=1 then 'owner' else 'member' end from generate_series(1,2) i;
insert into public.group_members(group_id,user_id,role) values ('d0000000-1111-4111-8111-111111111111','c1111111-1111-4111-8111-111111111111','owner');
create temporary table idea_deck_test(k text primary key,v jsonb) on commit drop;
grant all on idea_deck_test to service_role;
set local role service_role;
insert into idea_deck_test values('settings','{"category":"activities","center":{"lat":40,"lng":-73},"radiusM":5000,"poolSize":5,"closeThreshold":100,"deadlineAt":null,"includeGroupIdeas":true,"groupId":"c0000000-1111-4111-8111-111111111111"}');
insert into idea_deck_test select 'foreign',public.group_ideas('create','c1111111-1111-4111-8111-111111111111','d0000000-1111-4111-8111-111111111111',null,'{"name":"Private idea","category":"activity"}');
insert into idea_deck_test select 'idea',public.group_ideas('create','c1111111-1111-4111-8111-111111111111','c0000000-1111-4111-8111-111111111111',null,'{"name":"Catan","category":"activity","description":"Bring cards","locationText":"Johns house"}');
insert into idea_deck_test select 'off',public.pick_create_options('c1111111-1111-4111-8111-111111111111',(select v-'includeGroupIdeas'-'groupId' from idea_deck_test where k='settings'));
do $$ begin
 if (select include_group_ideas from public.picks where id=(select (v->>'id')::uuid from idea_deck_test where k='off')) then raise exception 'Enabled by default'; end if;
 begin perform public.pick_create_options('c1111111-1111-4111-8111-111111111111',(select v-'groupId' from idea_deck_test where k='settings')); raise exception 'Missing group allowed'; exception when sqlstate 'PT400' then null; end;
 begin perform public.pick_create_options('c3333333-1111-4111-8111-111111111111',(select v from idea_deck_test where k='settings')); raise exception 'Outsider enabled ideas'; exception when sqlstate 'PT404' then null; end;
end $$;
select 'ok 1 - opt-in defaults false and requires an accessible group';
insert into idea_deck_test select 'pick',public.pick_create_options('c1111111-1111-4111-8111-111111111111',(select v from idea_deck_test where k='settings'));
select public.pick_add_group((select (v->>'id')::uuid from idea_deck_test where k='pick'),'c1111111-1111-4111-8111-111111111111','c0000000-1111-4111-8111-111111111111');
do $$ declare r jsonb; begin
 r:=public.pick_load_options((select v->>'id' from idea_deck_test where k='pick'),'c1111111-1111-4111-8111-111111111111');
 if r->>'includeGroupIdeas'<>'true' or r->>'groupId'<>'c0000000-1111-4111-8111-111111111111' then raise exception 'Settings missing'; end if;
end $$;
select 'ok 2 - opt-in/group persisted and returned in lifecycle read';
insert into idea_deck_test select 'candidate',jsonb_build_object(
 'placeId','custom:c9999999-1111-4111-8111-111111111111','name',v->>'name','category','activities',
 'provider','custom','source','custom','origin','group_idea','groupIdeaId',v->>'id','groupId',v->>'group_id',
 'createdBy',v->>'created_by','note',v->>'description','address',v->>'location_text',
 'locationProvided',false,'lat',40,'lng',-73,'retention','persistable') from idea_deck_test where k='idea';
insert into idea_deck_test select 'deck',jsonb_build_array(
 jsonb_build_object('placeId',v->>'placeId','snapshot',v),
 jsonb_build_object('placeId','idea-deck-public','snapshot',jsonb_build_object('placeId','idea-deck-public','name','Bowling','category','activities','lat',40.01,'lng',-73))) from idea_deck_test where k='candidate';
select public.pick_start((select v->>'id' from idea_deck_test where k='pick'),'c1111111-1111-4111-8111-111111111111',(select v from idea_deck_test where k='deck'));
do $$ begin
 if (select count(*) from public.pick_candidates where pick_id=(select (v->>'id')::uuid from idea_deck_test where k='pick'))<>2 then raise exception 'Wrong deck'; end if;
 if not exists(select 1 from public.pick_candidates where source='custom' and snapshot->>'origin'='group_idea') then raise exception 'Provenance lost'; end if;
end $$;
select 'ok 3 - custom provenance and public candidates share canonical deck';
select public.group_ideas('update','c1111111-1111-4111-8111-111111111111','c0000000-1111-4111-8111-111111111111',(select (v->>'id')::uuid from idea_deck_test where k='idea'),'{"name":"New name","category":"activity"}');
select public.group_ideas('delete','c1111111-1111-4111-8111-111111111111','c0000000-1111-4111-8111-111111111111',(select (v->>'id')::uuid from idea_deck_test where k='idea'));
do $$ begin
 if (select snapshot from public.pick_candidates where place_id='custom:c9999999-1111-4111-8111-111111111111') is distinct from (select v from idea_deck_test where k='candidate') then raise exception 'Snapshot changed'; end if;
end $$;
select 'ok 4 - edits and deletion preserve frozen name/description/location/provenance';
select public.heartbeat_upsert_swipe(pc.pick_id::text,pp.user_id,pc.place_id,1)
 from public.pick_candidates pc join public.pick_participants pp on pp.pick_id=pc.pick_id
 where pc.pick_id=(select (v->>'id')::uuid from idea_deck_test where k='pick');
select public.pick_close_apply((select v->>'id' from idea_deck_test where k='pick'),'host','c1111111-1111-4111-8111-111111111111',
 (select version::text from public.picks where id=(select (v->>'id')::uuid from idea_deck_test where k='pick')),
 jsonb_build_object('state','final_vote','winnerPlaceId',null,'decidedBy',null,'voteDeadlineAt',now()+interval '30 minutes','rows',
 (select jsonb_agg(jsonb_build_object('place_id',place_id,'rank',r,'score',65,'finalist',true)) from
 (select place_id,row_number() over(order by place_id) r from public.pick_candidates where pick_id=(select (v->>'id')::uuid from idea_deck_test where k='pick')) x)));
select public.pick_cast_vote((select v->>'id' from idea_deck_test where k='pick'),pp.user_id,'custom:c9999999-1111-4111-8111-111111111111')
 from public.pick_participants pp where pp.pick_id=(select (v->>'id')::uuid from idea_deck_test where k='pick');
select public.pick_close_vote_apply((select v->>'id' from idea_deck_test where k='pick'),'custom:c9999999-1111-4111-8111-111111111111','vote');
do $$ begin
 if not exists(select 1 from public.picks where id=(select (v->>'id')::uuid from idea_deck_test where k='pick') and state='completed' and winner_place_id='custom:c9999999-1111-4111-8111-111111111111') then raise exception 'Idea did not win'; end if;
end $$;
select 'ok 5 - same swipe, rank, final vote and winner RPCs accept deleted-library snapshot';
insert into idea_deck_test select 'again',public.pick_again((select v->>'id' from idea_deck_test where k='pick'),'c1111111-1111-4111-8111-111111111111');
do $$ declare r jsonb; begin
 r:=public.pick_again((select v->>'id' from idea_deck_test where k='pick'),'c1111111-1111-4111-8111-111111111111');
 if r->>'id'<>(select v->>'id' from idea_deck_test where k='again') or not (select include_group_ideas from public.picks where id=(r->>'id')::uuid) then raise exception 'Repeat settings/reuse lost'; end if;
end $$;
select 'ok 6 - Pick Again preserves opt-in/current group and reuses draft';
insert into idea_deck_test select 'memberpick',public.pick_create_options('c2222222-1111-4111-8111-111111111111',(select v from idea_deck_test where k='settings'));
select public.pick_add_group((select (v->>'id')::uuid from idea_deck_test where k='memberpick'),'c2222222-1111-4111-8111-111111111111','c0000000-1111-4111-8111-111111111111');
reset role;
delete from public.group_members where group_id='c0000000-1111-4111-8111-111111111111' and user_id='c2222222-1111-4111-8111-111111111111';
set local role service_role;
do $$ begin
 begin perform public.pick_start((select v->>'id' from idea_deck_test where k='memberpick'),'c2222222-1111-4111-8111-111111111111',(select v from idea_deck_test where k='deck')); raise exception 'Removed host started deck'; exception when sqlstate 'PT404' then null; end;
 begin perform public.pick_refresh((select v->>'id' from idea_deck_test where k='memberpick'),'c2222222-1111-4111-8111-111111111111',(select v from idea_deck_test where k='deck')); raise exception 'Removed host refreshed deck'; exception when sqlstate 'PT404' then null; end;
end $$;
select 'ok 7 - atomic start/refresh rechecks membership after resolution';
do $$ begin
 begin perform public.pick_start((select v->>'id' from idea_deck_test where k='off'),'c1111111-1111-4111-8111-111111111111',(select v from idea_deck_test where k='deck')); raise exception 'Disabled Pick accepted idea'; exception when sqlstate 'PT400' then null; end;
 begin perform public.pick_start((select v->>'id' from idea_deck_test where k='again'),'c1111111-1111-4111-8111-111111111111',(select jsonb_set(v,'{0,snapshot,groupIdeaId}',(select v->'id' from idea_deck_test where k='foreign')) from idea_deck_test where k='deck')); raise exception 'Foreign idea disguised as own group'; exception when sqlstate 'PT400' then null; end;
 begin perform public.pick_start((select v->>'id' from idea_deck_test where k='again'),'c1111111-1111-4111-8111-111111111111',(select v from idea_deck_test where k='deck')); raise exception 'Deleted/cross-group library ID accepted'; exception when sqlstate 'PT400' then null; end;
end $$;
select 'ok 8 - commit checks idea belongs to current group; stale library resolution fails safely';
reset role;
delete from public.groups where id='c0000000-1111-4111-8111-111111111111';
set local role service_role;
do $$ declare r jsonb; begin
 r:=public.pick_load_options((select v->>'id' from idea_deck_test where k='pick'),'c1111111-1111-4111-8111-111111111111');
 if r is null or not exists(select 1 from jsonb_array_elements(r->'candidates') c where c->'snapshot'->>'name'='Catan') then raise exception 'Group deletion broke history'; end if;
end $$;
select 'ok 9 - group deletion does not remove historical candidate snapshots';

-- Both is a Pick category, while every stored place keeps its real category.
insert into idea_deck_test select 'both',public.pick_create_options('c1111111-1111-4111-8111-111111111111',
 (select (v-'groupId'-'includeGroupIdeas')||'{"category":"both"}'::jsonb from idea_deck_test where k='settings'));
reset role;
insert into public.pick_participants(pick_id,user_id) select (v->>'id')::uuid,'c2222222-1111-4111-8111-111111111111' from idea_deck_test where k='both';
set local role service_role;
select public.pick_start((select v->>'id' from idea_deck_test where k='both'),'c1111111-1111-4111-8111-111111111111',
 '[{"placeId":"both-food","snapshot":{"placeId":"both-food","name":"Cafe","category":"food","lat":40,"lng":-73}},
 {"placeId":"both-activity","snapshot":{"placeId":"both-activity","name":"Bowling","category":"activities","lat":40,"lng":-73}}]');
do $$ begin
 if (select category from public.places where id='both-food')<>'food'
 or (select category from public.places where id='both-activity')<>'activities'
 then raise exception 'Mixed Pick corrupted normalized categories'; end if;
end $$;
select 'ok 10 - Both Pick uses canonical start while places keep actual food/activity category';
rollback;
