-- The swipe clock restarts when the Pick starts (0052). Run: supabase test db.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(7);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '52111111-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'deadline-host@test.invalid', '{"display_name":"Host"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '52222222-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'deadline-guest@test.invalid', '{"display_name":"Guest"}', now(), now());

set local role service_role;

-- A 30-minute Pick whose host waited 25 minutes in the lobby, one whose request took two
-- minutes to arrive (so deadlineAt is only 28 minutes out), and one with no deadline.
create temporary table slow on commit drop as
  select (pick_create_options('52111111-1111-4111-8111-111111111111', jsonb_build_object(
    'category', 'food', 'center', jsonb_build_object('lat', 40.9, 'lng', -73.1), 'radiusM', 1000,
    'poolSize', 20, 'closeThreshold', 100, 'deadlineAt', now() + interval '28 minutes',
    'swipeMinutes', 30)) ->> 'id')::uuid as id;
create temporary table timed on commit drop as
  select (pick_create('52111111-1111-4111-8111-111111111111', 'food', 40.9, -73.1, 1000, 20,
    now() + interval '30 minutes', 100) ->> 'id')::uuid as id;
create temporary table untimed on commit drop as
  select (pick_create('52111111-1111-4111-8111-111111111111', 'food', 40.9, -73.1, 1000, 20,
    null, 100) ->> 'id')::uuid as id;
reset role;
update picks set created_at = created_at - interval '25 minutes',
  deadline_at = deadline_at - interval '25 minutes' where id = (select id from timed);
set local role service_role;
insert into pick_participants (pick_id, user_id)
  select id, '52222222-2222-4222-8222-222222222222'::uuid from timed
  union all select id, '52222222-2222-4222-8222-222222222222'::uuid from untimed
  union all select id, '52222222-2222-4222-8222-222222222222'::uuid from slow;

select lives_ok(
  $$select pick_start((select id::text from timed), '52111111-1111-4111-8111-111111111111',
      '[{"placeId":"dl-1","snapshot":{"name":"Deadline Cafe","lat":1,"lng":2}}]'::jsonb)$$,
  'host starts a timed Pick after waiting in the lobby');
select ok(
  (select deadline_at between now() + interval '29 minutes' and clock_timestamp() + interval '31 minutes'
     from picks where id = (select id from timed)),
  'the full 30 minutes start from the start, not from creation');

select is((select swipe_minutes from picks where id = (select id from slow)), 30,
  'create saves the chosen length');
select lives_ok(
  $$select pick_start((select id::text from slow), '52111111-1111-4111-8111-111111111111',
      '[{"placeId":"dl-3","snapshot":{"name":"Deadline Deli","lat":1,"lng":2}}]'::jsonb)$$,
  'host starts a Pick whose request was slow');
select ok(
  (select deadline_at between now() + interval '29 minutes 59 seconds'
     and clock_timestamp() + interval '30 minutes' from picks where id = (select id from slow)),
  'the chosen length wins over a deadline the latency shortened');

select lives_ok(
  $$select pick_start((select id::text from untimed), '52111111-1111-4111-8111-111111111111',
      '[{"placeId":"dl-2","snapshot":{"name":"Deadline Diner","lat":1,"lng":2}}]'::jsonb)$$,
  'host starts an untimed Pick');
select is((select deadline_at from picks where id = (select id from untimed)), null,
  'a Pick with no deadline still has none');

reset role;
select * from finish();
rollback;
