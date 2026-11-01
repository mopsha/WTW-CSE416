-- Standalone TAP assertions; transactions roll back all test data.
begin;
select '1..9';
insert into auth.users(id, raw_user_meta_data) values
 ('b1111111-1111-4111-8111-111111111111','{}'),
 ('b2222222-2222-4222-8222-222222222222','{}'),
 ('b3333333-3333-4333-8333-333333333333','{}');
create temporary table custom_test_pick as select (public.pick_create_options('b1111111-1111-4111-8111-111111111111',
 '{"category":"custom","center":{"lat":40,"lng":-73},"radiusM":5000,"poolSize":4,"closeThreshold":100,"deadlineAt":null,"includeSaved":true,"customOptions":[{"name":"Game night","note":"Bring cards"},{"name":"Basketball"},{"name":"Study session"},{"name":"Movie night","lat":40.01,"lng":-73}]}')->>'id')::uuid as id;
do $$ declare v_pick jsonb; begin
 v_pick := public.pick_load_options((select id::text from custom_test_pick),'b1111111-1111-4111-8111-111111111111');
 if v_pick->>'category' <> 'custom' or jsonb_array_length(v_pick->'customOptions') <> 4 or not (v_pick->>'includeSaved')::boolean then raise exception 'Custom inputs not retained'; end if;
 if exists(select 1 from jsonb_array_elements(v_pick->'customOptions') o where o->>'placeId' !~ '^custom:[0-9a-f-]{36}$' or o->>'createdBy' <> 'b1111111-1111-4111-8111-111111111111') then raise exception 'Invalid custom provenance'; end if;
end $$;
select 'ok 1 - four custom options have server UUIDs, creator and persistent includeSaved';
insert into public.pick_participants(pick_id,user_id) select id,'b2222222-2222-4222-8222-222222222222' from custom_test_pick;
select public.pick_start((select id::text from custom_test_pick),'b1111111-1111-4111-8111-111111111111',
 (select jsonb_agg(jsonb_build_object('placeId',o->>'placeId','snapshot',o)) from public.picks p, jsonb_array_elements(p.custom_options) o where p.id = (select id from custom_test_pick)));
do $$ begin
 if exists(select 1 from public.pick_candidates where pick_id=(select id from custom_test_pick) and (source <> 'custom' or created_by <> 'b1111111-1111-4111-8111-111111111111')) then raise exception 'Candidate provenance not persisted'; end if;
 if (select count(*) from public.pick_candidates where pick_id=(select id from custom_test_pick)) <> 4 then raise exception 'Custom deck not four'; end if;
 if exists(select 1 from public.places where id in(select place_id from public.pick_candidates where pick_id=(select id from custom_test_pick)) and (source<>'custom' or created_by<>'b1111111-1111-4111-8111-111111111111')) then raise exception 'Source/creator not persisted'; end if;
end $$;
select 'ok 2 - canonical pick_start accepts four custom snapshots and records source/creator';
-- Real canonical heartbeat RPCs, then a valid tied ranking write (all Maybe = 65).
select public.heartbeat_upsert_swipe((select id::text from custom_test_pick), pp.user_id, c.place_id, 1)
 from public.pick_participants pp join public.pick_candidates c using(pick_id) where pp.pick_id=(select id from custom_test_pick);
select public.pick_close_apply((select id::text from custom_test_pick), 'host', 'b1111111-1111-4111-8111-111111111111',
 (select version::text from public.picks where id=(select id from custom_test_pick)),
 jsonb_build_object('state','final_vote','winnerPlaceId',null,'voteDeadlineAt',now()+interval '30 minutes','rows',
 (select jsonb_agg(jsonb_build_object('place_id', place_id,'rank', r,'score',65,'finalist',true)) from
  (select place_id,row_number() over(order by place_id) r from public.pick_candidates where pick_id=(select id from custom_test_pick)) x)));
select public.pick_cast_vote((select id::text from custom_test_pick), pp.user_id,
 (select min(place_id) from public.pick_candidates where pick_id=(select id from custom_test_pick)))
 from public.pick_participants pp where pp.pick_id=(select id from custom_test_pick);
select public.pick_close_vote_apply((select id::text from custom_test_pick),
 (select min(place_id) from public.pick_candidates where pick_id=(select id from custom_test_pick)), 'vote');
do $$ begin
 if (select state from public.picks where id=(select id from custom_test_pick)) <> 'completed' then raise exception 'Custom flow did not complete'; end if;
end $$;
select 'ok 3 - canonical swipe, closing and final-vote RPCs complete a four-option Custom Pick';
do $$ begin
 begin perform public.pick_create_options('b1111111-1111-4111-8111-111111111111','{"category":"custom","customOptions":[{"name":"one"}]}'); raise exception 'One option allowed'; exception when sqlstate 'PT400' then null; end;
 begin perform public.pick_create_options('b1111111-1111-4111-8111-111111111111','{"category":"custom","customOptions":[{"name":""},{"name":"two"}]}'); raise exception 'Empty name allowed'; exception when sqlstate 'PT400' then null; end;
end $$;
select 'ok 4 - SQL rejects invalid custom options independently of client validation';
insert into public.hang_posts(id,author_id,starts_at,expires_at,activity,audience) values
 ('ba000000-0000-4000-8000-000000000001','b1111111-1111-4111-8111-111111111111',now()+interval '1 hour',now()+interval '5 hours','Game night','all_friends'),
 ('ba000000-0000-4000-8000-000000000002','b1111111-1111-4111-8111-111111111111',now()-interval '5 hours',now()-interval '1 hour','Expired','all_friends');
insert into public.hang_responses(post_id,user_id,status) values
 ('ba000000-0000-4000-8000-000000000001','b2222222-2222-4222-8222-222222222222','down'),
 ('ba000000-0000-4000-8000-000000000001','b3333333-3333-4333-8333-333333333333','maybe');
do $$ begin
 begin insert into public.hang_responses(post_id,user_id,status) values('ba000000-0000-4000-8000-000000000001','b2222222-2222-4222-8222-222222222222','cant'); raise exception 'Duplicate response allowed'; exception when unique_violation then null; end;
end $$;
select 'ok 5 - only one response per user/post';
set local role authenticated;
select set_config('request.jwt.claim.sub','b1111111-1111-4111-8111-111111111111',true);
do $$ begin
 if (select count(*) from public.hang_posts) <> 1 then raise exception 'Expired own posts visible'; end if;
end $$;
select 'ok 6 - author sees only active posts';
select set_config('request.jwt.claim.sub','b2222222-2222-4222-8222-222222222222',true);
do $$ begin
 if exists(select 1 from public.hang_posts) or exists(select 1 from public.hang_responses) then raise exception 'Shared data exposed without graph'; end if;
 begin insert into public.hang_responses(post_id,user_id,status) values('ba000000-0000-4000-8000-000000000001','b2222222-2222-4222-8222-222222222222','down'); raise exception 'Client bypassed authorization'; exception when insufficient_privilege then null; end;
end $$;
select 'ok 7 - relationship-dependent reads/writes fail closed pending teammate schema';
reset role;
set local role anon;
do $$ begin
 begin perform * from public.hang_posts; raise exception 'Anonymous hang read allowed'; exception when insufficient_privilege then null; end;
 begin perform public.pick_create_options('b1111111-1111-4111-8111-111111111111','{}'); raise exception 'Anonymous custom RPC allowed'; exception when insufficient_privilege then null; end;
end $$;
select 'ok 8 - anonymous access and custom RPC denied';
reset role;
insert into public.saved_places(user_id,place_id)
 select u.id, (select min(place_id) from public.pick_candidates where pick_id=(select id from custom_test_pick))
 from (values ('b2222222-2222-4222-8222-222222222222'::uuid),('b3333333-3333-4333-8333-333333333333'::uuid)) u(id);
set local role service_role;
do $$ begin
 if jsonb_array_length(public.saved_custom_candidates('b2222222-2222-4222-8222-222222222222')) <> 1 then raise exception 'Shared Pick member cannot resolve saved custom option'; end if;
 if jsonb_array_length(public.saved_custom_candidates('b3333333-3333-4333-8333-333333333333')) <> 0 then raise exception 'Guessed custom save leaked private snapshot'; end if;
end $$;
select 'ok 9 - custom hydration reuses Pick membership and denies guessed private IDs';
rollback;
