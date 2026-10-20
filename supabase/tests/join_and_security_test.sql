-- Join codes, joining by code, and cross-table security checks (Razin, M3).
-- Run: supabase db reset && supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(36);

-- Fixtures: host, guest, a late joiner, and a stranger who never joins.
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '61111111-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'join-host@test.invalid', '{"display_name":"Host"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '62222222-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'join-guest@test.invalid', '{"display_name":"Guest"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '63333333-3333-4333-8333-333333333333',
   'authenticated', 'authenticated', 'join-late@test.invalid', '{"display_name":"Late"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '64444444-4444-4444-8444-444444444444',
   'authenticated', 'authenticated', 'join-stranger@test.invalid', '{"display_name":"Stranger"}', now(), now());

-- Picks are created through the API's RPC, so the insert trigger issues their codes.
create temporary table pk on commit drop as
  select name, (pick_create('61111111-1111-4111-8111-111111111111', 'food', 40.9126, -73.1234,
    1000, 20, null, 100) ->> 'id')::uuid as id
  from (values ('main'), ('expired'), ('canceled'), ('completed'), ('final_vote'), ('vote')) as n(name);
create temporary table codes on commit drop as
  select pk.name, j.code from pk join pick_join_codes j on j.pick_id = pk.id;
-- Test bookkeeping only; the roles below must be able to read it.
grant select on pk, codes to public;

-- ---------------------------------------------------------------- codes are issued
select is((select count(*)::int from codes), 6, 'every new Pick gets exactly one join code');
select is(
  (select count(*)::int from codes where code ~ '^[A-HJ-NP-Z2-9]{6}$'), 6,
  'codes are 6 characters with no 0/O/1/I');
select ok(
  (select bool_and(expires_at between now() + interval '7 days' - interval '1 minute'
                                  and now() + interval '7 days' + interval '1 minute')
   from pick_join_codes where pick_id in (select id from pk)),
  'codes expire in 7 days');

-- ---------------------------------------------------------------- joining (as the API)
set local role service_role;
select is(
  pick_join((select code from codes where name = 'main'), '62222222-2222-4222-8222-222222222222'),
  (select id from pk where name = 'main'), 'join works with a valid code and returns the Pick id');
select is(
  pick_join((select code from codes where name = 'main'), '62222222-2222-4222-8222-222222222222'),
  (select id from pk where name = 'main'), 'joining twice still succeeds');
select is(
  (select count(*)::int from pick_participants
   where pick_id = (select id from pk where name = 'main') and user_id = '62222222-2222-4222-8222-222222222222'),
  1, 'joining twice leaves one participant row');

select throws_ok($$select pick_join('ZZZZZZ', '62222222-2222-4222-8222-222222222222')$$,
  'PT404', null, 'an unknown code is rejected');
select throws_ok($$select pick_join('not a code', '62222222-2222-4222-8222-222222222222')$$,
  'PT404', null, 'a malformed code is rejected');
select throws_ok($$select pick_join(null, '62222222-2222-4222-8222-222222222222')$$,
  'PT404', null, 'a null code is rejected');
reset role;

update pick_join_codes set expires_at = now() - interval '1 second'
  where pick_id = (select id from pk where name = 'expired');
select pick_cancel((select id::text from pk where name = 'canceled'), '61111111-1111-4111-8111-111111111111');
update picks set state = 'completed' where id = (select id from pk where name = 'completed');
update picks set state = 'final_vote' where id = (select id from pk where name = 'final_vote');

set local role service_role;
select throws_ok(
  format('select pick_join(%L, %L)', (select code from codes where name = 'expired'), '62222222-2222-4222-8222-222222222222'),
  'PT404', null, 'an expired code is rejected');
select throws_ok(
  format('select pick_join(%L, %L)', (select code from codes where name = 'canceled'), '62222222-2222-4222-8222-222222222222'),
  'PT409', null, 'a canceled Pick cannot be joined');
select throws_ok(
  format('select pick_join(%L, %L)', (select code from codes where name = 'completed'), '62222222-2222-4222-8222-222222222222'),
  'PT409', null, 'a completed Pick cannot be joined');
select throws_ok(
  format('select pick_join(%L, %L)', (select code from codes where name = 'final_vote'), '62222222-2222-4222-8222-222222222222'),
  'PT409', null, 'a Pick in its final vote cannot be joined');
select is(
  pick_join((select code from codes where name = 'completed'), '61111111-1111-4111-8111-111111111111'),
  (select id from pk where name = 'completed'), 'an existing participant may reopen a finished Pick by code');
select is(
  (select count(*)::int from pick_participants
   where pick_id in (select id from pk where name in ('expired', 'canceled', 'completed', 'final_vote'))),
  4, 'rejected joins added nobody (hosts only)');

-- Swiping is joinable; joining bumps the version (participants are a ranking input).
select pick_start((select id::text from pk where name = 'main'), '61111111-1111-4111-8111-111111111111',
  '[{"placeId":"js-1","snapshot":{"name":"One","lat":0,"lng":0}},
    {"placeId":"js-2","snapshot":{"name":"Two","lat":0,"lng":0}}]'::jsonb);
create temporary table v_before on commit drop as
  select version from picks where id = (select id from pk where name = 'main');
select is(
  pick_join('  ' || lower((select code from codes where name = 'main')) || ' ', '63333333-3333-4333-8333-333333333333'),
  (select id from pk where name = 'main'), 'a swiping Pick can be joined; case and spaces are ignored');
select ok(
  (select version from picks where id = (select id from pk where name = 'main')) > (select version from v_before),
  'joining advances the Pick version');
reset role;

-- ---------------------------------------------------------------- data for the RLS checks
insert into preferences (pick_id, place_id, user_id, value) values
  ((select id from pk where name = 'main'), 'js-1', '61111111-1111-4111-8111-111111111111', 2),
  ((select id from pk where name = 'main'), 'js-1', '62222222-2222-4222-8222-222222222222', 1);
-- A ranking row on a Pick that is still swiping (must not be readable yet).
insert into ranking_results (pick_id, place_id, rank, finalist, score) values
  ((select id from pk where name = 'main'), 'js-1', 1, false, 75.0);

-- ---------------------------------------------------------------- stranger who knows the ids
set local role authenticated;
set local request.jwt.claims to '{"sub":"64444444-4444-4444-8444-444444444444","role":"authenticated"}';
select is((select count(*)::int from picks where id in (select id from pk)), 0,
  'stranger sees no picks');
select is((select count(*)::int from pick_participants where pick_id in (select id from pk)), 0,
  'stranger sees no participants');
select is((select count(*)::int from pick_candidates where pick_id in (select id from pk)), 0,
  'stranger sees no candidates');
select is((select count(*)::int from preferences where pick_id in (select id from pk)), 0,
  'stranger sees no preferences');
select is((select count(*)::int from ranking_results where pick_id in (select id from pk)), 0,
  'stranger sees no ranking results');
select is((select count(*)::int from pick_join_codes where pick_id in (select id from pk)), 0,
  'stranger sees no join codes');

select throws_ok($$select pick_join('ZZZZZZ', auth.uid())$$, '42501', null,
  'authenticated cannot execute pick_join');
select throws_ok(
  format('insert into pick_participants (pick_id, user_id) values (%L, auth.uid())', (select id from pk where name = 'main')),
  '42501', null, 'authenticated cannot add itself as a participant directly');
select throws_ok($$insert into pick_join_codes (code, pick_id, expires_at) values ('ABCDEF', gen_random_uuid(), now())$$,
  '42501', null, 'authenticated cannot write join codes');
reset role;
set local role anon;
select throws_ok($$select pick_join('ZZZZZZ', gen_random_uuid())$$, '42501', null,
  'anon cannot execute pick_join');
reset role;

-- ---------------------------------------------------------------- participant
set local role authenticated;
set local request.jwt.claims to '{"sub":"62222222-2222-4222-8222-222222222222","role":"authenticated"}';
select is(
  (select code from pick_join_codes where pick_id = (select id from pk where name = 'main')),
  (select code from codes where name = 'main'), 'a participant can read the Pick''s join code');
select is((select count(*)::int from ranking_results where pick_id = (select id from pk where name = 'main')), 0,
  'ranking results are hidden while the Pick is swiping');
reset role;
update picks set state = 'completed' where id = (select id from pk where name = 'main');
set local role authenticated;
select is((select count(*)::int from ranking_results where pick_id = (select id from pk where name = 'main')), 1,
  'ranking results are visible once the Pick has left swiping');
reset role;

-- ---------------------------------------------------------------- final vote
set local role service_role;
select pick_join((select code from codes where name = 'vote'), '62222222-2222-4222-8222-222222222222');
select pick_start((select id::text from pk where name = 'vote'), '61111111-1111-4111-8111-111111111111',
  '[{"placeId":"jv-a","snapshot":{"name":"A","lat":0,"lng":0}},
    {"placeId":"jv-b","snapshot":{"name":"B","lat":0,"lng":0}},
    {"placeId":"jv-c","snapshot":{"name":"C","lat":0,"lng":0}}]'::jsonb);
reset role;
insert into ranking_results (pick_id, place_id, rank, finalist, score) values
  ((select id from pk where name = 'vote'), 'jv-a', 1, true, 60.0),
  ((select id from pk where name = 'vote'), 'jv-b', 2, true, 58.0),
  ((select id from pk where name = 'vote'), 'jv-c', 3, false, 20.0);
update picks set state = 'final_vote' where id = (select id from pk where name = 'vote');

set local role service_role;
select lives_ok(
  format('select pick_cast_vote(%L, %L, %L)', (select id from pk where name = 'vote'), '62222222-2222-4222-8222-222222222222', 'jv-a'),
  'a participant votes for a finalist');
select lives_ok(
  format('select pick_cast_vote(%L, %L, %L)', (select id from pk where name = 'vote'), '62222222-2222-4222-8222-222222222222', 'jv-b'),
  'voting again changes the ballot');
select is(
  (select count(*)::int from final_votes
   where pick_id = (select id from pk where name = 'vote') and user_id = '62222222-2222-4222-8222-222222222222'),
  1, 'a double vote leaves one row');
select is(
  (select place_id from final_votes
   where pick_id = (select id from pk where name = 'vote') and user_id = '62222222-2222-4222-8222-222222222222'),
  'jv-b', 'the row holds the latest ballot');
select throws_ok(
  format('select pick_cast_vote(%L, %L, %L)', (select id from pk where name = 'vote'), '62222222-2222-4222-8222-222222222222', 'jv-c'),
  'PT400', null, 'a vote for a non-finalist is rejected');
select throws_ok(
  format('select pick_cast_vote(%L, %L, %L)', (select id from pk where name = 'vote'), '64444444-4444-4444-8444-444444444444', 'jv-a'),
  'PT403', null, 'a stranger cannot vote');
reset role;

select * from finish();
rollback;
