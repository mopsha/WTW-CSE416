-- The swipe clock restarts when the Pick starts (0052). Run: supabase test db.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(33);

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

-- Drafts created before swipe_minutes use the same compatibility windows as the API.
create temporary table legacy_cases on commit drop as
select lead, expected, (pick_create('52111111-1111-4111-8111-111111111111', 'food',
  40.9, -73.1, 1000, 20, now() + lead * interval '1 second', 100) ->> 'id')::uuid as id
from (values (240,5),(300,5),(1500,30),(1560,30),(1800,30),(3300,60),
  (600,null),(720,null),(2040,null),
  (1801,30),(1829.999,30),(1830,30),(1830.001,null)) as cases(lead,expected);
insert into pick_participants (pick_id, user_id)
  select id, '52222222-2222-4222-8222-222222222222'::uuid from legacy_cases;

select lives_ok(format(
  'select pick_start(%L, %L, %L::jsonb)', id, '52111111-1111-4111-8111-111111111111',
  '[{"placeId":"dl-legacy","snapshot":{"name":"Legacy Cafe","lat":1,"lng":2}}]'),
  format('legacy %s-second lead starts', lead))
from legacy_cases where expected is not null;
select is(round(extract(epoch from picks.deadline_at - clock_timestamp()) / 60)::integer,
  expected, format('legacy %s-second lead keeps the supported %s-minute timer', lead, expected))
from legacy_cases join picks using (id) where expected is not null;

select throws_ok(format(
  'select pick_start(%L, %L, %L::jsonb)', id, '52111111-1111-4111-8111-111111111111',
  '[{"placeId":"dl-invalid","snapshot":{"name":"Invalid Cafe","lat":1,"lng":2}}]'),
  'PT400', 'This Pick has an unsupported swipe deadline. Cancel it and create a new Pick.',
  format('legacy %s-second lead is rejected', lead))
from legacy_cases where expected is null;
select ok(picks.state = 'draft' and picks.deadline_at = now() + lead * interval '1 second'
    and not exists (select 1 from pick_candidates where pick_id = picks.id),
  format('rejected %s-second lead leaves the draft and deck unchanged', lead))
from legacy_cases join picks using (id) where expected is null;

reset role;
select * from finish();
rollback;
