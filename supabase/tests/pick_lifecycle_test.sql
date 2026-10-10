-- Pick lifecycle RPC checks (Alan). Run: supabase test db (after supabase db reset).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(24);

-- Fixtures: a host, a second participant, and an outsider.
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '31111111-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'lifecycle-host@test.invalid', '{"display_name":"Host"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '32222222-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'lifecycle-guest@test.invalid', '{"display_name":"Guest"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '39999999-9999-4999-8999-999999999999',
   'authenticated', 'authenticated', 'lifecycle-outsider@test.invalid', '{}', now(), now());

set local role service_role;

-- ---------------------------------------------------------------- pick_create
select throws_ok(
  $$select pick_create('31111111-1111-4111-8111-111111111111', 'food', 0, 0, 0, 20, null, 100)$$,
  'PT400', null, 'create rejects an invalid radius');

create temporary table new_pick on commit drop as
  select (pick_create(
    '31111111-1111-4111-8111-111111111111', 'food', 40.9126, -73.1234, 1000, 20, null, 100
  ) ->> 'id')::uuid as id;

select is((select count(*)::int from picks where id = (select id from new_pick)), 1, 'create inserts the Pick');
select is((select pool_size from picks where id = (select id from new_pick)), 20, 'pool_size defaults as given');
select is(
  (select count(*)::int from pick_participants
   where pick_id = (select id from new_pick) and user_id = '31111111-1111-4111-8111-111111111111'),
  1, 'the host is added as the first participant');

-- ---------------------------------------------------------------- pick_load
select is(pick_load('not-a-uuid', '31111111-1111-4111-8111-111111111111'), null, 'malformed id -> null (404)');
select throws_ok(
  $$select pick_load((select id::text from new_pick), '39999999-9999-4999-8999-999999999999')$$,
  'PT403', null, 'load denies outsiders');
select is(
  (select s ->> 'state' from (select pick_load((select id::text from new_pick), '31111111-1111-4111-8111-111111111111') as s) t),
  'draft', 'load returns the draft state');

-- ---------------------------------------------------------------- pick_start
select throws_ok(
  $$select pick_start((select id::text from new_pick), '32222222-2222-4222-8222-222222222222', '[{"placeId":"x","snapshot":{"lat":0,"lng":0}}]'::jsonb)$$,
  'PT403', null, 'start rejects a non-host');
select throws_ok(
  $$select pick_start((select id::text from new_pick), '31111111-1111-4111-8111-111111111111', '[{"placeId":"x","snapshot":{"lat":0,"lng":0}}]'::jsonb)$$,
  'PT409', null, 'start rejects fewer than 2 participants');

insert into pick_participants (pick_id, user_id) values ((select id from new_pick), '32222222-2222-4222-8222-222222222222');

select throws_ok(
  $$select pick_start((select id::text from new_pick), '31111111-1111-4111-8111-111111111111', '[]'::jsonb)$$,
  'PT400', null, 'start rejects an empty candidate list');

select lives_ok(
  $$select pick_start((select id::text from new_pick), '31111111-1111-4111-8111-111111111111',
      '[{"placeId":"lc-1","snapshot":{"name":"Lifecycle Cafe","lat":1,"lng":2}},
        {"placeId":"lc-2","snapshot":{"name":"Lifecycle Diner","lat":3,"lng":4}}]'::jsonb)$$,
  'host starts the Pick with a built pool');
select is((select state::text from picks where id = (select id from new_pick)), 'swiping', 'start transitions to swiping');
select is((select count(*)::int from pick_candidates where pick_id = (select id from new_pick)), 2, 'candidates are frozen');
select is((select count(*)::int from places where id in ('lc-1', 'lc-2')), 2, 'start upserts public.places from the pool');
select throws_ok(
  $$select pick_start((select id::text from new_pick), '31111111-1111-4111-8111-111111111111', '[{"placeId":"lc-3","snapshot":{"lat":0,"lng":0}}]'::jsonb)$$,
  'PT409', null, 'starting twice is rejected (not draft)');

-- ---------------------------------------------------------------- pick_refresh
insert into preferences (pick_id, place_id, user_id, value) values
  ((select id from new_pick), 'lc-1', '31111111-1111-4111-8111-111111111111', 2);
select is((select count(*)::int from preferences where pick_id = (select id from new_pick)), 1, 'a swipe is recorded before refresh');
select throws_ok(
  $$select pick_refresh((select id::text from new_pick), '32222222-2222-4222-8222-222222222222', '[{"placeId":"lc-9","snapshot":{"lat":0,"lng":0}}]'::jsonb)$$,
  'PT403', null, 'refresh rejects a non-host');
select lives_ok(
  $$select pick_refresh((select id::text from new_pick), '31111111-1111-4111-8111-111111111111',
      '[{"placeId":"lc-9","snapshot":{"name":"Lifecycle Pub","lat":5,"lng":6}}]'::jsonb)$$,
  'host refreshes the pool');
select is((select count(*)::int from pick_candidates where pick_id = (select id from new_pick)), 1, 'refresh replaces the candidate pool');
select is(
  (select count(*)::int from preferences where pick_id = (select id from new_pick)),
  0, 'refresh clears every answer by cascading the deleted candidates');

-- ---------------------------------------------------------------- pick_cancel
select throws_ok(
  $$select pick_cancel((select id::text from new_pick), '32222222-2222-4222-8222-222222222222')$$,
  'PT403', null, 'cancel rejects a non-host');
select lives_ok(
  $$select pick_cancel((select id::text from new_pick), '31111111-1111-4111-8111-111111111111')$$,
  'host cancels the Pick');
select is((select state::text from picks where id = (select id from new_pick)), 'canceled', 'cancel transitions to canceled');
select throws_ok(
  $$select pick_cancel((select id::text from new_pick), '31111111-1111-4111-8111-111111111111')$$,
  'PT409', null, 'cancel rejects an already-terminal Pick');

reset role;
select * from finish();
rollback;
