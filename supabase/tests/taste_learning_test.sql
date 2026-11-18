-- Taste learning (0047_taste_learning.sql, Alan). Run: supabase test db (after supabase db reset).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(34);

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

-- Old signals fade: 30 days later a new Maybe lands on half the old one.
update taste_signals set at = now() - interval '30 days'
  where user_id = '71111111-1111-4111-8111-111111111111' and place_type = 'pizza_restaurant';
-- learn_taste is trigger-only (no service_role grant); call it as the owner here.
reset role;
select private.learn_taste('71111111-1111-4111-8111-111111111111', gen_random_uuid(),
  'pizza_restaurant', 0.3);
select ok(abs((select score from learned_taste
  where user_id = '71111111-1111-4111-8111-111111111111' and place_type = 'pizza_restaurant')
  - 0.45) < 0.001, 'signals halve after 30 days');

select private.learn_taste('71111111-1111-4111-8111-111111111111', gen_random_uuid(), 'park', 50);
set local role service_role;
select is((select score from learned_taste
  where user_id = '71111111-1111-4111-8111-111111111111' and place_type = 'park'),
  10::real, 'one signal is clamped to 10');

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
select ok(abs(coalesce((select score from learned_taste
  where user_id = '71111111-1111-4111-8111-111111111111' and place_type = 'cafe'), 0)) < 0.001,
  'refresh takes back the wiped deck''s swipes, so re-swiping can''t double count');

-- Josh's review cases: undoing an answer takes back exactly what it added.
create temporary table tp3 on commit drop as
  select (pick_create(
    '71111111-1111-4111-8111-111111111111', 'food', 40.9126, -73.1234, 1000, 20, null, 100
  ) ->> 'id')::uuid as id;
insert into pick_participants (pick_id, user_id) values
  ((select id from tp3), '72222222-2222-4222-8222-222222222222');
select pick_start((select id::text from tp3), '71111111-1111-4111-8111-111111111111',
  '[{"placeId":"q-1","snapshot":{"name":"Q1","lat":0,"lng":0,"tasteType":"ramen_restaurant"}},
    {"placeId":"q-2","snapshot":{"name":"Q2","lat":0,"lng":0,"tasteType":"bowling_alley"}},
    {"placeId":"q-3","snapshot":{"name":"Q3","lat":0,"lng":0,"tasteType":"museum"}}]'::jsonb);
create temporary table learned3 on commit drop as
  select '71111111-1111-4111-8111-111111111111'::uuid as u;

select heartbeat_upsert_swipe((select id::text from tp3), (select u from learned3), 'q-1', 2);
delete from taste_signals where user_id = (select u from learned3);  -- Reset
select heartbeat_upsert_swipe((select id::text from tp3), (select u from learned3), 'q-1', 0);
select ok(abs((select score from learned_taste where user_id = (select u from learned3)
  and place_type = 'ramen_restaurant') - (-1)) < 0.001, 'Yes, Reset, then No leaves -1');

select heartbeat_upsert_swipe((select id::text from tp3), (select u from learned3), 'q-3', 2);
update taste_signals set at = now() - interval '30 days'
  where user_id = (select u from learned3) and place_type = 'museum';
select heartbeat_upsert_swipe((select id::text from tp3), (select u from learned3), 'q-3', 0);
select ok(abs((select score from learned_taste where user_id = (select u from learned3)
  and place_type = 'museum') - (-1)) < 0.001, 'a 30-day-old Yes changed to No leaves -1');

-- Learning is optional: if recording a signal fails, the swipe still saves.
reset role;
create function public.taste_test_fail() returns trigger language plpgsql as $$
begin raise exception 'learning unavailable'; end $$;
create trigger fail_taste before insert or update on public.taste_signals
  for each row execute function public.taste_test_fail();
set local role service_role;
select lives_ok($$select heartbeat_upsert_swipe((select id::text from tp3),
  '72222222-2222-4222-8222-222222222222', 'q-2', 2)$$, 'a failed signal does not fail the swipe');
select is((select value::int from preferences where pick_id = (select id from tp3)
  and user_id = '72222222-2222-4222-8222-222222222222' and place_id = 'q-2'), 2,
  'the swipe is saved without its signal');
reset role;
drop trigger fail_taste on public.taste_signals;
set local role service_role;

select heartbeat_upsert_swipe((select id::text from tp3), (select u from learned3), 'q-2', 2);
delete from taste_signals where user_id = (select u from learned3);  -- Reset
select pick_refresh((select id::text from tp3), (select u from learned3),
  '[{"placeId":"q-4","snapshot":{"name":"Q4","lat":0,"lng":0}}]'::jsonb);
select is((select count(*)::int from learned_taste where user_id = (select u from learned3)),
  0, 'Yes, Reset, then Refresh leaves nothing');

-- Saving the deck's group scores is optional too: a failure still starts the Pick.
create temporary table tp4 on commit drop as
  select (pick_create(
    '71111111-1111-4111-8111-111111111111', 'food', 40.9126, -73.1234, 1000, 20, null, 100
  ) ->> 'id')::uuid as id;
insert into pick_participants (pick_id, user_id) values
  ((select id from tp4), '72222222-2222-4222-8222-222222222222');
reset role;
create trigger fail_taste before insert on private.pick_candidate_taste
  for each row execute function public.taste_test_fail();
set local role service_role;
select lives_ok($$select pick_start((select id::text from tp4),
  '71111111-1111-4111-8111-111111111111',
  '[{"placeId":"f-1","snapshot":{"name":"F1","lat":0,"lng":0},"tasteScore":0.5}]'::jsonb)$$,
  'a failed taste save does not fail the start');
select is((select state::text from picks where id = (select id from tp4)), 'swiping',
  'the Pick starts without group scores');
reset role;
drop trigger fail_taste on private.pick_candidate_taste;
set local role service_role;

-- Scheduled Picks start through pick_availability_finish, not pick_start; they store taste too.
create temporary table sched on commit drop as
  select (pick_create_options('71111111-1111-4111-8111-111111111111', jsonb_build_object(
    'category', 'food', 'center', jsonb_build_object('lat', 40, 'lng', -73), 'radiusM', 3000,
    'poolSize', 10, 'closeThreshold', 100, 'deadlineAt', null,
    'proposedAt', now() + interval '2 days', 'swipeDeadlineMinutes', 60)) ->> 'id')::uuid as id;
select pick_availability_finish((select id::text from sched), '71111111-1111-4111-8111-111111111111',
  (pick_availability_claim((select id::text from sched), '71111111-1111-4111-8111-111111111111')
    ->> 'token')::uuid,
  '[{"placeId":"s-sushi","snapshot":{"name":"Sushi","lat":40,"lng":-73,"tasteType":"sushi_restaurant"},"tasteScore":0.5},
    {"placeId":"s-plain","snapshot":{"name":"Plain","lat":40,"lng":-73}}]'::jsonb);
select is((select count(*)::int from private.pick_candidate_taste where pick_id = (select id from sched)),
  1, 'scheduled Picks store taste scores when they start');

-- The ±10 cap applies after the API fades the total (groupTaste.decayedScore), not here:
-- twenty 60-day-old +1 signals total 20 as of their own time, which fades to 5.
reset role;
select private.learn_taste('72222222-2222-4222-8222-222222222222', gen_random_uuid(), 'zoo', 1)
  from generate_series(1, 20);
set local role service_role;
update taste_signals set at = now() - interval '60 days'
  where user_id = '72222222-2222-4222-8222-222222222222' and place_type = 'zoo';
select ok(abs((select score from learned_taste where user_id = '72222222-2222-4222-8222-222222222222'
  and place_type = 'zoo') - 20) < 0.01, 'the view does not cap before the final fade');

-- Group scores from an older deck are ignored, and the sweep removes ones for finished Picks.
update private.pick_candidate_taste set candidate_generation = gen_random_uuid()
  where pick_id = (select id from sched) and place_id = 's-sushi';
select is((select e ->> 'tasteScore' from jsonb_array_elements(
  pick_load_for_close((select id::text from sched)) -> 'candidates') e
  where e ->> 'placeId' = 's-sushi'), '0', 'a score for an older deck''s candidate is ignored');
update private.pick_candidate_taste t set candidate_generation=c.taste_generation
  from public.pick_candidates c where t.pick_id=c.pick_id and t.place_id=c.place_id
  and t.pick_id=(select id from sched);
reset role;
alter table public.picks disable trigger forget_candidate_taste;
update picks set state = 'canceled' where id = (select id from sched);
alter table public.picks enable trigger forget_candidate_taste;
set local role service_role;
select purge_google_coordinates(now() - interval '30 days');
select is((select count(*)::int from private.pick_candidate_taste where pick_id = (select id from sched)),
  0, 'the sweep removes group scores the close left behind');

-- Privacy: clients can't read learned taste or the group scores.
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"72222222-2222-4222-8222-222222222222","role":"authenticated"}';
select throws_ok($$select * from learned_taste$$, '42501', null,
  'clients cannot read learned_taste directly');
select throws_ok($$select * from private.pick_candidate_taste$$, '42501', null,
  'clients cannot read group taste scores');
select throws_ok($$select * from taste_signals$$, '42501', null,
  'clients cannot read taste signals');
select throws_ok($$select private.learn_taste('72222222-2222-4222-8222-222222222222',
  gen_random_uuid(), 'zoo', 5)$$, '42501', null, 'clients cannot add learning signals');
select throws_ok($$select pick_load_for_close((select id::text from tp2))$$, '42501', null,
  'clients cannot call the re-created close snapshot');

select * from finish();
rollback;
