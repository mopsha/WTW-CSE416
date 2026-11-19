-- Guests leave, start saves a wider area with its deck, and a tally only settles the ballots
-- it counted (0053). Run: supabase test db.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(20);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '53111111-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'leave-host@test.invalid', '{"display_name":"Host"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '53222222-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'leave-guest@test.invalid', '{"display_name":"Guest"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '53333333-3333-4333-8333-333333333333',
   'authenticated', 'authenticated', 'leave-voter@test.invalid', '{"display_name":"Voter"}', now(), now());

set local role service_role;

create temporary table p on commit drop as
  select (pick_create('53111111-1111-4111-8111-111111111111', 'food', 40.9, -73.1, 1000, 20,
    null, 100) ->> 'id')::uuid as id;
insert into pick_participants (pick_id, user_id)
  select id, '53222222-2222-4222-8222-222222222222'::uuid from p;

-- pick_start_checked: the wider area is saved with the deck, or not at all, and only for the
-- people the deck was built for.
select throws_ok(
  $$select pick_start_checked((select id::text from p), '53222222-2222-4222-8222-222222222222',
      '[{"placeId":"lv-1","snapshot":{"name":"Leave Cafe","lat":1,"lng":2}}]'::jsonb, 4000,
      array['53111111-1111-4111-8111-111111111111', '53222222-2222-4222-8222-222222222222']::uuid[])$$,
  'PT409', null, 'a guest cannot start or change the area');
select throws_ok(
  $$select pick_start_checked((select id::text from p), '53111111-1111-4111-8111-111111111111',
      '[]'::jsonb, 4000,
      array['53111111-1111-4111-8111-111111111111', '53222222-2222-4222-8222-222222222222']::uuid[])$$,
  'PT400', null, 'a start that fails…');
select is((select radius_m from picks where id = (select id from p)), 1000,
  '…keeps the original area');
select is(
  pick_start_checked((select id::text from p), '53111111-1111-4111-8111-111111111111',
    '[{"placeId":"lv-1","snapshot":{"name":"Leave Cafe","lat":1,"lng":2}}]'::jsonb, 4000,
    array['53111111-1111-4111-8111-111111111111']::uuid[]),
  false, 'a deck built for an older roster does not start');
select is((select (state::text) from picks where id = (select id from p)), 'draft',
  'the Pick stays a draft for a rebuild');
select lives_ok(
  $$select pick_start_checked((select id::text from p), '53111111-1111-4111-8111-111111111111',
      '[{"placeId":"lv-1","snapshot":{"name":"Leave Cafe","lat":1,"lng":2}}]'::jsonb, 4000,
      array['53111111-1111-4111-8111-111111111111', '53222222-2222-4222-8222-222222222222']::uuid[])$$,
  'the host starts with a wider area');
select ok((select radius_m = 4000 and state = 'swiping' from picks where id = (select id from p)),
  'the wider radius is saved with the started deck');
select throws_ok(
  $$select pick_start_checked((select id::text from p), '53111111-1111-4111-8111-111111111111',
      '[{"placeId":"lv-1","snapshot":{"name":"Leave Cafe","lat":1,"lng":2}}]'::jsonb, 8000,
      array['53111111-1111-4111-8111-111111111111', '53222222-2222-4222-8222-222222222222']::uuid[])$$,
  'PT409', null, 'a second start changes nothing');
select is((select radius_m from picks where id = (select id from p)), 4000,
  'the losing start does not save its radius');

-- pick_leave: guests only, and their answers go with them.
insert into preferences (pick_id, user_id, place_id, value)
  select id, '53222222-2222-4222-8222-222222222222'::uuid, 'lv-1', 2 from p;
select throws_ok(
  $$select pick_leave((select id::text from p), '53111111-1111-4111-8111-111111111111')$$,
  'PT409', null, 'the host cannot leave');
select lives_ok(
  $$select pick_leave((select id::text from p), '53222222-2222-4222-8222-222222222222')$$,
  'a guest leaves mid-swipe');
select is((select count(*)::int from preferences where pick_id = (select id from p)), 0,
  'their swipes are removed');
select throws_ok(
  $$select pick_leave((select id::text from p), '53222222-2222-4222-8222-222222222222')$$,
  'PT404', null, 'leaving twice finds nothing');

-- pick_close_vote_apply with ballots: a guest leaves after their vote was counted.
create temporary table v on commit drop as
  select (pick_create('53111111-1111-4111-8111-111111111111', 'food', 40.9, -73.1, 1000, 20,
    null, 100) ->> 'id')::uuid as id;
insert into pick_participants (pick_id, user_id)
  select id, '53333333-3333-4333-8333-333333333333'::uuid from v;
select pick_start((select id::text from v), '53111111-1111-4111-8111-111111111111',
  '[{"placeId":"vt-a","snapshot":{"name":"A","lat":1,"lng":2}},
    {"placeId":"vt-b","snapshot":{"name":"B","lat":1,"lng":2}}]'::jsonb);
reset role;
update picks set state = 'final_vote' where id = (select id from v);
insert into ranking_results (pick_id, place_id, rank, finalist, score)
  select id, 'vt-a', 1, true, 1 from v union all select id, 'vt-b', 2, true, 0 from v;
set local role service_role;
select pick_cast_vote((select id::text from v), '53333333-3333-4333-8333-333333333333', 'vt-b');
create temporary table counted on commit drop as
  select s -> 'ballots' as ballots, s -> 'participantIds' as voters
    from pick_load_for_vote((select id::text from v)) s;
select pick_leave((select id::text from v), '53333333-3333-4333-8333-333333333333');
select is(
  pick_close_vote_apply((select id::text from v), 'vt-b', 'vote', (select ballots from counted),
    (select voters from counted)),
  false, 'a tally that counted a departed guest does not settle');
select is((select state::text from picks where id = (select id from v)), 'final_vote',
  'the vote stays open for a recount');
select is(
  pick_close_vote_apply((select id::text from v), 'vt-a', 'tie_break', '[]'::jsonb,
    '["53111111-1111-4111-8111-111111111111"]'::jsonb),
  true, 'the recount settles');
select ok((select state = 'completed' and winner_place_id = 'vt-a' from picks
  where id = (select id from v)), 'the departed guest''s vote did not pick the winner');
select is(
  pick_close_vote_apply((select id::text from v), 'vt-b', 'vote', '[]'::jsonb, '[]'::jsonb),
  true, 'a late tally is a no-op');

-- A scheduled Pick where the host declined: when the last eligible voter leaves the final
-- vote, the round is canceled instead of declaring a winner with no voters.
create temporary table sv on commit drop as
  select (pick_create_options('53111111-1111-4111-8111-111111111111', jsonb_build_object(
    'category', 'food', 'center', jsonb_build_object('lat', 40, 'lng', -73), 'radiusM', 3000,
    'poolSize', 10, 'closeThreshold', 100, 'deadlineAt', null,
    'proposedAt', now() + interval '2 days', 'swipeDeadlineMinutes', 60)) ->> 'id')::uuid as id;
insert into pick_participants (pick_id, user_id)
  select id, '53222222-2222-4222-8222-222222222222'::uuid from sv;
reset role;
update picks set state = 'final_vote', availability_locked_at = now()
 where id = (select id from sv);
insert into pick_voting_cohort (pick_id, user_id, revision)
  select id, '53222222-2222-4222-8222-222222222222'::uuid, 1 from sv;
set local role service_role;
select is(jsonb_array_length(pick_load_for_vote((select id::text from sv)) -> 'participantIds'), 1,
  'only the guest is eligible to vote');
select pick_leave((select id::text from sv), '53222222-2222-4222-8222-222222222222');
select ok((select state = 'canceled' and winner_place_id is null from picks
  where id = (select id from sv)), 'the round is canceled with no winner');

reset role;
select * from finish();
rollback;
