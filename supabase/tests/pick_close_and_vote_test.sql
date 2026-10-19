-- Closing and final-vote RPC checks (Alan). Run: supabase test db (after supabase db reset).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(25);

-- Fixtures: a host and two more participants.
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '41111111-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'close-host@test.invalid', '{"display_name":"Host"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '42222222-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'close-guest@test.invalid', '{"display_name":"Guest"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '43333333-3333-4333-8333-333333333333',
   'authenticated', 'authenticated', 'close-third@test.invalid', '{"display_name":"Third"}', now(), now());

set local role service_role;

create temporary table pick1 on commit drop as
  select (pick_create(
    '41111111-1111-4111-8111-111111111111', 'food', 40.9126, -73.1234, 1000, 20, null, 100
  ) ->> 'id')::uuid as id;
insert into pick_participants (pick_id, user_id) values
  ((select id from pick1), '42222222-2222-4222-8222-222222222222'),
  ((select id from pick1), '43333333-3333-4333-8333-333333333333');
select pick_start((select id::text from pick1), '41111111-1111-4111-8111-111111111111',
  '[{"placeId":"cv-1","snapshot":{"name":"Clear Winner","lat":0,"lng":0}},
    {"placeId":"cv-2","snapshot":{"name":"Runner Up","lat":0,"lng":0}}]'::jsonb);

-- Everyone says Yes to cv-1, No to cv-2: a clear winner.
insert into preferences (pick_id, place_id, user_id, value)
select (select id from pick1), p.place_id, u.user_id, p.value
from (values ('cv-1', 2), ('cv-2', 0)) as p(place_id, value)
cross join (values
  ('41111111-1111-4111-8111-111111111111'::uuid),
  ('42222222-2222-4222-8222-222222222222'::uuid),
  ('43333333-3333-4333-8333-333333333333'::uuid)
) as u(user_id);

select throws_ok(
  $$select pick_close_apply((select id::text from pick1), 'host', '42222222-2222-4222-8222-222222222222', '1', '{"rows":[],"state":"completed","winnerPlaceId":null}'::jsonb)$$,
  'PT403', null, 'close_apply rejects a non-host host-close');

create temporary table snap1 on commit drop as
  select pick_load_for_close((select id::text from pick1)) as s;
select is((select s ->> 'state' from snap1), 'swiping', 'load_for_close sees the swiping Pick');

create temporary table payload1 on commit drop as
  select jsonb_build_object(
    'state', 'completed', 'winnerPlaceId', 'cv-1',
    'rows', jsonb_build_array(
      jsonb_build_object('place_id', 'cv-1', 'rank', 1, 'score', 94.0, 'finalist', false),
      jsonb_build_object('place_id', 'cv-2', 'rank', 2, 'score', 6.0, 'finalist', false)
    )
  ) as p;
select throws_ok(
  $$select pick_close_apply((select id::text from pick1), 'host', '41111111-1111-4111-8111-111111111111', '0', (select p from payload1))$$,
  'PT409', null, 'close_apply rejects a stale version');
select lives_ok(
  $$select pick_close_apply((select id::text from pick1), 'host', '41111111-1111-4111-8111-111111111111', (select s ->> 'version' from snap1), (select p from payload1))$$,
  'host closes with a clear winner');
select is(
  (select row(state::text, winner_place_id, decided_by)::text from picks where id = (select id from pick1)),
  '(completed,cv-1,clear_winner)', 'close_apply persists the clear winner');
select throws_ok(
  $$select pick_close_apply((select id::text from pick1), 'host', '41111111-1111-4111-8111-111111111111', (select s ->> 'version' from snap1), (select p from payload1))$$,
  'PT409', null, 'retrying after completion is a conflict');

-- ---------------------------------------------------------------- a second Pick that goes to a vote
create temporary table pick2 on commit drop as
  select (pick_create(
    '41111111-1111-4111-8111-111111111111', 'food', 40.9126, -73.1234, 1000, 20, null, 100
  ) ->> 'id')::uuid as id;
insert into pick_participants (pick_id, user_id) values
  ((select id from pick2), '42222222-2222-4222-8222-222222222222'),
  ((select id from pick2), '43333333-3333-4333-8333-333333333333');
select pick_start((select id::text from pick2), '41111111-1111-4111-8111-111111111111',
  '[{"placeId":"fv-a","snapshot":{"name":"Finalist A","lat":0,"lng":0}},
    {"placeId":"fv-b","snapshot":{"name":"Finalist B","lat":0,"lng":0}}]'::jsonb);

create temporary table payload2 on commit drop as
  select jsonb_build_object(
    'state', 'final_vote', 'winnerPlaceId', null,
    'voteDeadlineAt', to_jsonb(now() + interval '30 minutes'),
    'rows', jsonb_build_array(
      jsonb_build_object('place_id', 'fv-a', 'rank', 1, 'score', 55.0, 'finalist', true),
      jsonb_build_object('place_id', 'fv-b', 'rank', 2, 'score', 50.0, 'finalist', true)
    )
  ) as p;
-- The swipe deadline has already passed: the case where a sweep closes swiping.
update picks set deadline_at = now() - interval '1 minute' where id = (select id from pick2);
create temporary table snap2 on commit drop as
  select pick_load_for_close((select id::text from pick2)) as s;

select throws_ok(
  $$select pick_close_apply((select id::text from pick2), 'system', null, (select s ->> 'version' from snap2),
      (select p - 'voteDeadlineAt' from payload2))$$,
  'PT400', null, 'entering final_vote without a vote deadline is rejected');
select throws_ok(
  $$select pick_close_apply((select id::text from pick2), 'system', null, (select s ->> 'version' from snap2),
      jsonb_set((select p from payload2), '{voteDeadlineAt}', '"not-a-date"'))$$,
  'PT400', null, 'a malformed vote deadline is a 400, not a 500');
select lives_ok(
  $$select pick_close_apply((select id::text from pick2), 'system', null, (select s ->> 'version' from snap2),
      (select p from payload2))$$,
  'a system close enters final_vote with a vote deadline');
select is((select state::text from picks where id = (select id from pick2)), 'final_vote', 'a system close enters final_vote');
select ok(
  (select vote_deadline_at > now() and vote_deadline_at > deadline_at and deadline_at < now()
   from picks where id = (select id from pick2)),
  'the vote deadline is in the future and later than the expired swipe deadline');
select is(
  (select pick_load_for_vote((select id::text from pick2)) ->> 'voteDeadlineAt') is not null,
  true, 'load_for_vote returns the vote deadline');

-- Re-running the close (even with the current version and a later deadline) must not move it.
create temporary table vd2 on commit drop as
  select vote_deadline_at as v from picks where id = (select id from pick2);
select throws_ok(
  $$select pick_close_apply((select id::text from pick2), 'system', null,
      (select pick_load_for_close((select id::text from pick2)) ->> 'version'),
      jsonb_set((select p from payload2), '{voteDeadlineAt}', to_jsonb(now() + interval '2 hours')))$$,
  'PT409', null, 're-closing a Pick already in final_vote is rejected');
select is(
  (select vote_deadline_at from picks where id = (select id from pick2)), (select v from vd2),
  'the vote deadline was not extended or reset');

select throws_ok(
  $$select pick_cast_vote((select id::text from pick2), '44444444-4444-4444-8444-444444444444', 'fv-a')$$,
  'PT403', null, 'cast_vote rejects a non-participant');
select throws_ok(
  $$select pick_cast_vote((select id::text from pick2), '42222222-2222-4222-8222-222222222222', 'not-a-finalist')$$,
  'PT400', null, 'cast_vote rejects a non-finalist');
select lives_ok(
  $$select pick_cast_vote((select id::text from pick2), '41111111-1111-4111-8111-111111111111', 'fv-a')$$,
  'host casts a ballot');
select lives_ok(
  $$select pick_cast_vote((select id::text from pick2), '41111111-1111-4111-8111-111111111111', 'fv-b')$$,
  'a ballot can be changed before the vote closes');
select is(
  (select place_id from final_votes where pick_id = (select id from pick2) and user_id = '41111111-1111-4111-8111-111111111111'),
  'fv-b', 'the changed ballot overwrites the first one');

select throws_ok(
  $$select pick_close_vote_apply((select id::text from pick2), 'not-a-finalist', 'vote')$$,
  'PT400', null, 'close_vote_apply rejects a non-finalist winner');
select throws_ok(
  $$select pick_close_vote_apply((select id::text from pick2), 'fv-b', 'banana')$$,
  'PT400', null, 'close_vote_apply rejects an unknown decided_by');
select lives_ok(
  $$select pick_close_vote_apply((select id::text from pick2), 'fv-b', 'tie_break')$$,
  'closing the vote settles the Pick');
select is(
  (select row(state::text, winner_place_id, decided_by)::text from picks where id = (select id from pick2)),
  '(completed,fv-b,tie_break)', 'close_vote_apply persists the winner and tie_break (bug #17)');
select lives_ok(
  $$select pick_close_vote_apply((select id::text from pick2), 'fv-a', 'vote')$$,
  'closing an already-settled vote is a silent no-op');
select is(
  (select winner_place_id from picks where id = (select id from pick2)),
  'fv-b', 'a settled vote cannot be re-settled with a different winner');

reset role;
select * from finish();
rollback;
