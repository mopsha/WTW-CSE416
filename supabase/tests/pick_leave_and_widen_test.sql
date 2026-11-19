-- Guests leave, and start saves a wider area (0053). Run: supabase test db.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(9);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '53111111-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'leave-host@test.invalid', '{"display_name":"Host"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '53222222-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'leave-guest@test.invalid', '{"display_name":"Guest"}', now(), now());

set local role service_role;

create temporary table p on commit drop as
  select (pick_create('53111111-1111-4111-8111-111111111111', 'food', 40.9, -73.1, 1000, 20,
    null, 100) ->> 'id')::uuid as id;
insert into pick_participants (pick_id, user_id)
  select id, '53222222-2222-4222-8222-222222222222'::uuid from p;

-- pick_set_radius: host and draft only.
select throws_ok(
  $$select pick_set_radius((select id::text from p), '53222222-2222-4222-8222-222222222222', 4000)$$,
  'PT409', null, 'a guest cannot change the area');
select lives_ok(
  $$select pick_set_radius((select id::text from p), '53111111-1111-4111-8111-111111111111', 4000)$$,
  'the host widens a draft Pick');
select is((select radius_m from picks where id = (select id from p)), 4000, 'the wider radius is saved');

select lives_ok(
  $$select pick_start((select id::text from p), '53111111-1111-4111-8111-111111111111',
      '[{"placeId":"lv-1","snapshot":{"name":"Leave Cafe","lat":1,"lng":2}}]'::jsonb)$$,
  'host starts');
insert into preferences (pick_id, user_id, place_id, value)
  select id, '53222222-2222-4222-8222-222222222222'::uuid, 'lv-1', 2 from p;
select throws_ok(
  $$select pick_set_radius((select id::text from p), '53111111-1111-4111-8111-111111111111', 8000)$$,
  'PT409', null, 'the area is fixed once swiping starts');

-- pick_leave: guests only, and their answers go with them.
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

reset role;
select * from finish();
rollback;
