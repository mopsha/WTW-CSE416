-- Plan time, RSVP, "Did you go?", history, Pick again, reason counts (Alan, M4; 0013).
-- Run: supabase db reset && supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(34);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'a1111111-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'p-host@test.invalid', '{"display_name":"Host"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a2222222-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'p-guest@test.invalid', '{"display_name":"Guest"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a3333333-3333-4333-8333-333333333333',
   'authenticated', 'authenticated', 'p-third@test.invalid', '{"display_name":"Third"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a4444444-4444-4444-8444-444444444444',
   'authenticated', 'authenticated', 'p-stranger@test.invalid', '{"display_name":"Stranger"}', now(), now());

create temporary table pk on commit drop as
  select name, (pick_create('a1111111-1111-4111-8111-111111111111', 'food', 40.9126, -73.1234,
    1000, 20, null, 100) ->> 'id')::uuid as id
  from (values ('done'), ('live')) as n(name);
grant select on pk to public;

insert into places (id, name, category, lat, lng) values
  ('plan-a', 'Alpha', 'food', 40.91, -73.12), ('plan-b', 'Bravo', 'food', 40.91, -73.12),
  ('plan-c', 'Charlie', 'food', 40.91, -73.12), ('plan-d', 'Delta', 'food', 40.91, -73.12)
on conflict do nothing;
insert into pick_participants (pick_id, user_id)
  select id, u from pk, unnest(array['a2222222-2222-4222-8222-222222222222',
                                      'a3333333-3333-4333-8333-333333333333']::uuid[]) u
  where name = 'done'
  union all
  select id, 'a2222222-2222-4222-8222-222222222222' from pk where name = 'live';
insert into pick_candidates (pick_id, place_id, snapshot)
  select pk.id, p.id, jsonb_build_object('name', p.name, 'lat', p.lat, 'lng', p.lng)
  from pk, places p where pk.name = 'done' and p.id like 'plan-%';
insert into preferences (pick_id, place_id, user_id, value)
  select (select id from pk where name = 'done'), v.place, v.u::uuid, v.value
  from (values
    ('plan-a', 'a1111111-1111-4111-8111-111111111111', 2), ('plan-a', 'a2222222-2222-4222-8222-222222222222', 2),
    ('plan-a', 'a3333333-3333-4333-8333-333333333333', 2), ('plan-b', 'a1111111-1111-4111-8111-111111111111', 2),
    ('plan-b', 'a2222222-2222-4222-8222-222222222222', 1), ('plan-b', 'a3333333-3333-4333-8333-333333333333', 0)
  ) as v(place, u, value);
insert into ranking_results (pick_id, place_id, rank, finalist, score)
  select (select id from pk where name = 'done'), v.place, v.rank, false, v.score
  from (values ('plan-a', 1, 100), ('plan-b', 2, 55), ('plan-c', 3, 40), ('plan-d', 4, 30)) as v(place, rank, score);
update picks set state = 'completed', winner_place_id = 'plan-a', decided_at = now(),
  decided_by = 'clear_winner' where id = (select id from pk where name = 'done');
update picks set state = 'swiping' where id = (select id from pk where name = 'live');

set local role service_role;
-- ---------------------------------------------------------------- plan time
select is(
  pick_set_plan_time((select id from pk where name = 'done')::text,
    'a1111111-1111-4111-8111-111111111111', now() + interval '2 hours'),
  array['a2222222-2222-4222-8222-222222222222', 'a3333333-3333-4333-8333-333333333333']::uuid[],
  'the host sets the time and gets everyone else back to notify');
select is(
  (select pick_set_plan_time(id::text, 'a1111111-1111-4111-8111-111111111111', plan_at)
   from picks where id = (select id from pk where name = 'done')),
  '{}'::uuid[], 'setting the same time again changes nothing and notifies nobody');
select throws_ok(
  format($$select pick_set_plan_time(%L, 'a2222222-2222-4222-8222-222222222222', now())$$,
    (select id from pk where name = 'done')),
  'PT403', null, 'a guest cannot set the time');
select throws_ok(
  format($$select pick_set_plan_time(%L, 'a1111111-1111-4111-8111-111111111111', now())$$,
    (select id from pk where name = 'live')),
  'PT409', null, 'no plan time before there is a winner');
select throws_ok(
  format($$select pick_set_plan_time(%L, 'a4444444-4444-4444-8444-444444444444', now())$$,
    (select id from pk where name = 'done')),
  'PT404', null, 'a stranger gets not-found');

-- ---------------------------------------------------------------- RSVP and outcome
select lives_ok(
  format($$select pick_rsvp(%L, 'a2222222-2222-4222-8222-222222222222', 'going')$$,
    (select id from pk where name = 'done')), 'a guest RSVPs');
select pick_rsvp((select id from pk where name = 'done')::text, 'a2222222-2222-4222-8222-222222222222', 'maybe');
select is(
  (select status from pick_rsvps where user_id = 'a2222222-2222-4222-8222-222222222222'),
  'maybe', 'changing an RSVP keeps one row');
select pick_rsvp((select id from pk where name = 'done')::text, 'a3333333-3333-4333-8333-333333333333', 'not_going');
select throws_ok(
  format($$select pick_rsvp(%L, 'a2222222-2222-4222-8222-222222222222', 'yes')$$,
    (select id from pk where name = 'done')),
  'PT400', null, 'an unknown RSVP is rejected');
select throws_ok(
  format($$select pick_rsvp(%L, 'a4444444-4444-4444-8444-444444444444', 'going')$$,
    (select id from pk where name = 'done')),
  'PT404', null, 'a stranger cannot RSVP');
select throws_ok(
  format($$select pick_outcome(%L, 'a2222222-2222-4222-8222-222222222222', true, null)$$,
    (select id from pk where name = 'live')),
  'PT409', null, 'no outcome before there is a winner');
select pick_outcome((select id from pk where name = 'done')::text, 'a1111111-1111-4111-8111-111111111111', true, true);
select is(
  pick_plan_load((select id from pk where name = 'done')::text, 'a1111111-1111-4111-8111-111111111111')
    - 'planAt',
  jsonb_build_object(
    'state', 'completed', 'isHost', true, 'participantCount', 3,
    'rsvps', jsonb_build_object('going', 0, 'maybe', 1, 'notGoing', 1), 'myRsvp', null,
    'outcomes', jsonb_build_object('went', 1, 'didNotGo', 0, 'again', 1),
    'myOutcome', jsonb_build_object('went', true, 'again', true)),
  'the plan summary is counts plus my own answers');
select throws_ok(
  format($$select pick_plan_load(%L, 'a4444444-4444-4444-8444-444444444444')$$,
    (select id from pk where name = 'done')),
  'PT404', null, 'a stranger cannot load the plan');

-- ---------------------------------------------------------------- reading (clients)
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"a2222222-2222-4222-8222-222222222222","role":"authenticated"}';
select is((select count(*)::int from pick_rsvps), 1, 'a participant reads only their own RSVP, not who said what');
select throws_ok(
  $$insert into pick_rsvps (pick_id, user_id, status) select id, 'a2222222-2222-4222-8222-222222222222', 'going' from pk where name = 'live'$$,
  '42501', null, 'clients cannot write RSVPs');
select throws_ok(
  $$update pick_outcomes set went = false$$, '42501', null, 'clients cannot write outcomes');
set local request.jwt.claims to '{"sub":"a4444444-4444-4444-8444-444444444444","role":"authenticated"}';
select is((select count(*)::int from pick_rsvps) + (select count(*)::int from pick_outcomes), 0,
  'strangers read nothing');

-- ---------------------------------------------------------------- history
reset role;
set local role service_role;
select is(jsonb_array_length(pick_history('a2222222-2222-4222-8222-222222222222')), 1,
  'history has my completed Pick and not the live one');
select is(jsonb_array_length(pick_history('a4444444-4444-4444-8444-444444444444')), 0,
  'a stranger has no history of it');
select is(
  (select jsonb_agg(f ->> 'name') from jsonb_array_elements(
     pick_history('a1111111-1111-4111-8111-111111111111') -> 0 -> 'finalists') f),
  '["Alpha", "Bravo", "Charlie"]'::jsonb, 'finalists are the top three by rank');
select ok(
  (pick_history('a1111111-1111-4111-8111-111111111111')::text !~ '"score"'),
  'history never includes scores');
select is(
  (pick_history('a1111111-1111-4111-8111-111111111111') -> 0 ->> 'wentCount')::int, 1,
  'history says how many went');
select is(
  (pick_history('a1111111-1111-4111-8111-111111111111') -> 0 -> 'winner' ->> 'name'), 'Alpha',
  'history names the winner');
select throws_ok(
  $$select pick_history('a1111111-1111-4111-8111-111111111111', '0f8fad5b-d9cb-469f-a165-70867728950e')$$,
  'PT404', null, 'an unknown group (or groups not installed) is not-found');

-- ---------------------------------------------------------------- reasons
select is(
  (select array_agg(yes || '/' || maybe || '/' || no || '/' || n order by rank)
   from pick_finalist_counts((select id from pk where name = 'done')::text,
     'a2222222-2222-4222-8222-222222222222')),
  array['3/0/0/3', '1/1/1/3', '0/0/0/3'], 'per-finalist counts for the top three');
select throws_ok(
  format($$select * from pick_finalist_counts(%L, 'a2222222-2222-4222-8222-222222222222')$$,
    (select id from pk where name = 'live')),
  'PT409', null, 'no counts before the Pick closes');

-- ---------------------------------------------------------------- sweep targets
select is(
  (select count(*)::int from pick_plan_targets(now() + interval '90 minutes') where kind = 'plan_reminder'),
  1, 'the plan reminder is due an hour before');
select is(
  (select user_ids from pick_plan_targets(now() + interval '6 hours') where kind = 'did_you_go'),
  array['a2222222-2222-4222-8222-222222222222']::uuid[],
  '"Did you go?" skips people who said they can''t go and people who already answered');
select is(
  (select count(*)::int from pick_plan_targets(now() + interval '20 days')),
  0, 'old Picks are left alone');

-- ---------------------------------------------------------------- Pick again
select throws_ok(
  format($$select pick_again(%L, 'a2222222-2222-4222-8222-222222222222')$$,
    (select id from pk where name = 'done')),
  'PT403', null, 'only the host can pick again');
create temporary table again on commit drop as
  select pick_again((select id from pk where name = 'done')::text,
    'a1111111-1111-4111-8111-111111111111') as r;
select is(
  (select host_id from picks where id = (select (r ->> 'id')::uuid from again)),
  'a1111111-1111-4111-8111-111111111111'::uuid, 'the host hosts the new Pick');
select throws_ok(
  format($$select pick_again(%L, 'a1111111-1111-4111-8111-111111111111')$$,
    (select id from pk where name = 'done')),
  'PT409', null, 'no second copy while the first is still a draft');
select is(
  (select count(*)::int from pick_participants where pick_id = (select (r ->> 'id')::uuid from again)),
  3, 'the new Pick has the same three people');
select throws_ok(
  format($$select pick_again(%L, 'a1111111-1111-4111-8111-111111111111')$$,
    (select id from pk where name = 'live')),
  'PT409', null, 'a Pick that is still going cannot be picked again');

-- The time can change at most 5 times (the first set above was change 1).
select pick_set_plan_time((select id from pk where name = 'done')::text,
  'a1111111-1111-4111-8111-111111111111', now() + make_interval(hours => 2 + g))
from generate_series(1, 4) g;
select throws_ok(
  format($$select pick_set_plan_time(%L, 'a1111111-1111-4111-8111-111111111111', now() + interval '9 hours')$$,
    (select id from pk where name = 'done')),
  'PT409', null, 'a sixth change is refused, so the host cannot spam everyone');

select * from finish();
rollback;
