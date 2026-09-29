-- RLS, grants and heartbeat RPC checks. Run: supabase test db (after supabase db reset).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(39);

-- Fixtures (as postgres): a participant ("me") and an outsider.
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'me@test.invalid', '{"display_name":"Me"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'out@test.invalid', '{}', now(), now());

select is((select count(*)::int from profiles where id in (
  '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')),
  2, 'profiles are created on sign-up');
select is((select display_name from profiles where id = '11111111-1111-4111-8111-111111111111'),
  'Me', 'display_name comes from user metadata');

select private.seed_add_participant('11111111-1111-4111-8111-111111111111');
insert into preferences (pick_id, place_id, user_id, value) values
  ('de000000-0000-4000-8000-000000000001', 'placeholder-place-01', '11111111-1111-4111-8111-111111111111', 2);
insert into ranking_results (pick_id, place_id, rank, finalist, score) values
  ('de000000-0000-4000-8000-000000000001', 'placeholder-place-01', 1, true, 88.5);

select throws_ok(
  $$insert into preferences (pick_id, place_id, user_id, value) values
    ('de000000-0000-4000-8000-000000000001', 'placeholder-place-02', '11111111-1111-4111-8111-111111111111', 3)$$,
  '23514', null, 'preferences.value must be 0..2');
select throws_ok(
  $$insert into preferences (pick_id, place_id, user_id, value) values
    ('de000000-0000-4000-8000-000000000001', 'placeholder-place-02', '22222222-2222-4222-8222-222222222222', 1)$$,
  '23503', null, 'only participants can have preferences');

-- ---------------------------------------------------------------- participant
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select is((select count(*)::int from picks), 1, 'participant sees the demo Pick');
select is((select count(*)::int from pick_candidates), 20, 'participant sees 20 candidates');
select is((select count(*)::int from pick_participants), 4, 'participant sees all 4 participants');
select is((select count(*)::int from profiles), 4, 'participant sees own + co-participant profiles');
select is((select count(*)::int from places), 20, 'participant sees candidate places');
select is((select count(*)::int from preferences), 1, 'participant sees only own preferences');
select is((select count(*)::int from preferences where user_id <> auth.uid()), 0, 'bots'' answers are hidden');
select is((select count(*)::int from ranking_results), 1, 'participant sees ranking rows');
select lives_ok($$select pick_id, place_id, rank, finalist from ranking_results$$, 'safe ranking columns are readable');
select throws_ok($$select * from ranking_results$$, '42501', null, 'select * on ranking_results is denied');
select throws_ok($$select score from ranking_results$$, '42501', null, 'score is not readable');
select throws_ok(
  $$insert into preferences (pick_id, place_id, user_id, value) values
    ('de000000-0000-4000-8000-000000000001', 'placeholder-place-03', auth.uid(), 2)$$,
  '42501', null, 'clients cannot insert preferences');
select throws_ok($$update picks set state = 'canceled'$$, '42501', null, 'clients cannot update picks');
select throws_ok($$delete from pick_participants$$, '42501', null, 'clients cannot delete participants');
select throws_ok($$insert into profiles (id) values (gen_random_uuid())$$, '42501', null, 'clients cannot insert profiles');
select throws_ok($$update profiles set display_name = 'x'$$, '42501', null, 'clients cannot update profiles');
select throws_ok(
  $$select public.heartbeat_load_pick('de000000-0000-4000-8000-000000000001', auth.uid())$$,
  '42501', null, 'clients cannot call heartbeat RPCs');
select throws_ok(
  $$select private.seed_add_participant(auth.uid(), true)$$,
  '42501', null, 'clients cannot call the seed helper');

-- ---------------------------------------------------------------- outsider
set local request.jwt.claims to '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select is((select count(*)::int from picks), 0, 'outsider sees no Picks');
select is((select count(*)::int from pick_candidates) + (select count(*)::int from pick_participants)
  + (select count(*)::int from places) + (select count(*)::int from preferences)
  + (select count(*)::int from ranking_results), 0, 'outsider sees no Pick data');
select is((select count(*)::int from profiles), 1, 'outsider sees only own profile');

-- ---------------------------------------------------------------- anon
reset request.jwt.claims;
set local role anon;
select throws_ok($$select id from picks$$, '42501', null, 'anon cannot read picks');
select throws_ok($$select id from profiles$$, '42501', null, 'anon cannot read profiles');

-- ---------------------------------------------------------------- heartbeat RPCs (service_role)
set local role service_role;
select is(
  (select jsonb_build_object(
     'n', jsonb_array_length(s -> 'participantIds'),
     'c', jsonb_array_length(s -> 'candidates'),
     'p', jsonb_array_length(s -> 'preferences'),
     'host', s ->> 'hostId', 'state', s ->> 'state')
   from heartbeat_load_pick('de000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111') s),
  '{"n":4,"c":20,"p":61,"host":"b0700000-0000-4000-8000-000000000001","state":"swiping"}'::jsonb,
  'load_pick returns the snapshot');
select is(heartbeat_load_pick('not-a-uuid', '11111111-1111-4111-8111-111111111111'), null, 'malformed id -> null (404)');
select throws_ok(
  $$select heartbeat_load_pick('de000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222')$$,
  'PT403', null, 'load_pick denies outsiders');

create temporary table v0 on commit drop as
  select heartbeat_load_pick('de000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111') ->> 'version' as v;
select lives_ok(
  $$select heartbeat_upsert_swipe('de000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'placeholder-place-01', 0)$$,
  'upsert_swipe updates an answer');
select isnt(
  heartbeat_load_pick('de000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111') ->> 'version',
  (select v from v0), 'a swipe advances the version');
select throws_ok(
  $$select heartbeat_upsert_swipe('de000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'nope', 1)$$,
  'PT400', null, 'upsert_swipe rejects foreign candidates');
select throws_ok(
  $$select heartbeat_upsert_swipe('de000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'placeholder-place-01', 1)$$,
  'PT403', null, 'upsert_swipe rejects outsiders');

-- Ranking payload built from the current snapshot: rank by place id, winner = rank 1.
create temporary table snap on commit drop as
  select heartbeat_load_pick('de000000-0000-4000-8000-000000000001', 'b0700000-0000-4000-8000-000000000001') as s;
create temporary table payload on commit drop as
  select jsonb_build_object(
    'state', 'completed', 'winnerPlaceId', 'placeholder-place-01',
    'rows', jsonb_agg(jsonb_build_object('place_id', c ->> 'placeId', 'rank', i, 'score', 100 - i, 'finalist', false))
  ) as p
  from snap, jsonb_array_elements(s -> 'candidates') with ordinality as t(c, i);

select throws_ok(
  $$select heartbeat_save_ranking('de000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
      (select s ->> 'version' from snap), (select p from payload))$$,
  'PT403', null, 'save_ranking rejects a non-host participant');
select throws_ok(
  $$select heartbeat_save_ranking('de000000-0000-4000-8000-000000000001', 'b0700000-0000-4000-8000-000000000001',
      '0', (select p from payload))$$,
  'PT409', null, 'save_ranking rejects a stale version');
select lives_ok(
  $$select heartbeat_save_ranking('de000000-0000-4000-8000-000000000001', 'b0700000-0000-4000-8000-000000000001',
      (select s ->> 'version' from snap), (select p from payload))$$,
  'host saves a clear-winner ranking');
select throws_ok(
  $$select heartbeat_save_ranking('de000000-0000-4000-8000-000000000001', 'b0700000-0000-4000-8000-000000000001',
      (select s ->> 'version' from snap), (select p from payload))$$,
  'PT409', null, 'retrying after completion is a conflict');

reset role;
select is(
  (select row(state::text, winner_place_id, decided_by, (select count(*)::int from ranking_results r where r.pick_id = p.id))::text
   from picks p where id = 'de000000-0000-4000-8000-000000000001'),
  '(completed,placeholder-place-01,clear_winner,20)', 'ranking persisted with winner metadata');

select * from finish();
rollback;
