-- Taste learning (0044_taste_learning.sql, Alan). Run: supabase test db (after supabase db reset).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(22);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '71111111-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'taste-host@test.invalid', '{"display_name":"Host"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '72222222-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'taste-guest@test.invalid', '{"display_name":"Guest"}', now(), now());

set local role service_role;

create temporary table tp on commit drop as
  select (pick_create(
    '71111111-1111-4111-8111-111111111111', 'food', 40.9126, -73.1234, 1000, 20, null, 100
  ) ->> 'id')::uuid as id;
insert into pick_participants (pick_id, user_id) values
  ((select id from tp), '72222222-2222-4222-8222-222222222222');

select lives_ok(
  $$select pick_start((select id::text from tp), '71111111-1111-4111-8111-111111111111',
    '[{"placeId":"t-sushi","snapshot":{"name":"Sushi","lat":0,"lng":0,"tasteType":"sushi_restaurant"},"tasteScore":0.5},
      {"placeId":"t-pizza","snapshot":{"name":"Pizza","lat":0,"lng":0,"tasteType":"pizza_restaurant"},"tasteScore":-0.25},
      {"placeId":"t-plain","snapshot":{"name":"Plain","lat":0,"lng":0},"tasteScore":0}]'::jsonb)$$,
  'pick_start accepts candidates carrying taste');

select is((select count(*)::int from private.pick_candidate_taste where pick_id = (select id from tp)),
  2, 'start stores non-zero taste scores only');

create temporary table snap on commit drop as select pick_load_for_close((select id::text from tp)) as s;
select is(
  (select e ->> 'tasteScore' from snap, jsonb_array_elements(s -> 'candidates') e
   where e ->> 'placeId' = 't-sushi'), '0.5', 'load_for_close carries the taste score');
select is(
  (select e ->> 'tasteScore' from snap, jsonb_array_elements(s -> 'candidates') e
   where e ->> 'placeId' = 't-plain'), '0', 'candidates without taste read as 0');
select is((select s ->> 'state' from snap), 'swiping', 'the wrapped snapshot keeps its fields');

-- Swipes teach: Yes +1, then changed to No (net -1); Maybe +0.3; untyped places teach nothing.
insert into preferences (pick_id, place_id, user_id, value) values
  ((select id from tp), 't-sushi', '71111111-1111-4111-8111-111111111111', 2),
  ((select id from tp), 't-pizza', '71111111-1111-4111-8111-111111111111', 1),
  ((select id from tp), 't-plain', '71111111-1111-4111-8111-111111111111', 2);
select is((select score from learned_taste
  where user_id = '71111111-1111-4111-8111-111111111111' and place_type = 'sushi_restaurant'),
  1::real, 'a Yes swipe adds 1');
select is((select score from learned_taste
  where user_id = '71111111-1111-4111-8111-111111111111' and place_type = 'pizza_restaurant'),
  0.3::real, 'a Maybe swipe adds 0.3');
select is((select count(*)::int from learned_taste
  where user_id = '71111111-1111-4111-8111-111111111111'), 2, 'an untyped place teaches nothing');

update preferences set value = 0
  where place_id = 't-sushi' and user_id = '71111111-1111-4111-8111-111111111111';
select ok(abs((select score from learned_taste
  where user_id = '71111111-1111-4111-8111-111111111111' and place_type = 'sushi_restaurant')
  - (-1)) < 0.001, 'changing Yes to No replaces the signal (1 - 2 = -1)');

-- Old scores fade: 30 days later a new Maybe lands on half the old score.
update learned_taste set updated_at = now() - interval '30 days'
  where user_id = '71111111-1111-4111-8111-111111111111' and place_type = 'pizza_restaurant';
-- learn_taste is trigger-only (no service_role grant); call it as the owner here.
reset role;
select private.learn_taste('71111111-1111-4111-8111-111111111111', 'pizza_restaurant', 0.3);
select ok(abs((select score from learned_taste
  where user_id = '71111111-1111-4111-8111-111111111111' and place_type = 'pizza_restaurant')
  - 0.45) < 0.001, 'scores halve after 30 days before adding');

select private.learn_taste('71111111-1111-4111-8111-111111111111', 'park', 50);
set local role service_role;
select is((select score from learned_taste
  where user_id = '71111111-1111-4111-8111-111111111111' and place_type = 'park'),
  10::real, 'scores are clamped to 10');

-- A winner teaches everyone in the Pick (+2).
update picks set state = 'completed', winner_place_id = 't-sushi', decided_at = now(),
  decided_by = 'clear_winner' where id = (select id from tp);
select is((select score from learned_taste
  where user_id = '72222222-2222-4222-8222-222222222222' and place_type = 'sushi_restaurant'),
  2::real, 'the winner adds 2 for every participant');
select is((select count(*)::int from private.pick_candidate_taste where pick_id = (select id from tp)),
  0, 'group scores are dropped once the Pick leaves swiping');
update picks set cancel_reason = 'later edit' where id = (select id from tp);
select is((select score from learned_taste
  where user_id = '72222222-2222-4222-8222-222222222222' and place_type = 'sushi_restaurant'),
  2::real, 'later updates to a decided Pick do not teach again');

-- Refresh replaces the deck and its taste rows.
create temporary table tp2 on commit drop as
  select (pick_create(
    '71111111-1111-4111-8111-111111111111', 'food', 40.9126, -73.1234, 1000, 20, null, 100
  ) ->> 'id')::uuid as id;
insert into pick_participants (pick_id, user_id) values
  ((select id from tp2), '72222222-2222-4222-8222-222222222222');
select pick_start((select id::text from tp2), '71111111-1111-4111-8111-111111111111',
  '[{"placeId":"r-1","snapshot":{"name":"R1","lat":0,"lng":0,"tasteType":"cafe"},"tasteScore":0.9}]'::jsonb);
-- The real swipe path: an upsert. Repeating the same answer teaches once; changing it replaces.
select heartbeat_upsert_swipe((select id::text from tp2), '71111111-1111-4111-8111-111111111111', 'r-1', 2);
select heartbeat_upsert_swipe((select id::text from tp2), '71111111-1111-4111-8111-111111111111', 'r-1', 2);
select is((select score from learned_taste
  where user_id = '71111111-1111-4111-8111-111111111111' and place_type = 'cafe'),
  1::real, 'a repeated identical swipe (upsert) counts once');
select heartbeat_upsert_swipe((select id::text from tp2), '71111111-1111-4111-8111-111111111111', 'r-1', 1);
select ok(abs((select score from learned_taste
  where user_id = '71111111-1111-4111-8111-111111111111' and place_type = 'cafe') - 0.3) < 0.001,
  'changing an upserted Yes to Maybe leaves 0.3');
select pick_refresh((select id::text from tp2), '71111111-1111-4111-8111-111111111111',
  '[{"placeId":"r-2","snapshot":{"name":"R2","lat":0,"lng":0},"tasteScore":0.4}]'::jsonb);
select is((select array_agg(place_id) from private.pick_candidate_taste where pick_id = (select id from tp2)),
  array['r-2'], 'refresh keeps only the new deck''s taste');
select ok(abs((select score from learned_taste
  where user_id = '71111111-1111-4111-8111-111111111111' and place_type = 'cafe')) < 0.001,
  'refresh takes back the wiped deck''s swipes, so re-swiping can''t double count');

-- Privacy: clients can't read learned taste or the group scores.
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"72222222-2222-4222-8222-222222222222","role":"authenticated"}';
select throws_ok($$select * from learned_taste$$, '42501', null,
  'clients cannot read learned_taste directly');
select throws_ok($$select * from private.pick_candidate_taste$$, '42501', null,
  'clients cannot read group taste scores');
select throws_ok($$select private.learn_taste('72222222-2222-4222-8222-222222222222', 'zoo', 5)$$,
  '42501', null, 'clients cannot add learning signals');
select throws_ok($$select pick_load_for_close((select id::text from tp2))$$, '42501', null,
  'clients cannot call the re-created close snapshot');

select * from finish();
rollback;
