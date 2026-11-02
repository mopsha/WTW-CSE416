-- Review fixes on integ/m4 (Alan; 0019): reminder timing, push token cap, "Did you go?" only
-- after launch, Pick again keeps settings and drops removed group members.
-- Run: supabase db reset && supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(9);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'b1111111-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'f-host@test.invalid', '{"display_name":"Host"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b2222222-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'f-stay@test.invalid', '{"display_name":"Stay"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b3333333-3333-4333-8333-333333333333',
   'authenticated', 'authenticated', 'f-gone@test.invalid', '{"display_name":"Gone"}', now(), now());

-- ------------------------------------------------------------ reminder timing
create temporary table pk on commit drop as
  select name, (pick_create('b1111111-1111-4111-8111-111111111111', 'food', 40.9, -73.1,
    1000, 20, now() + d, 100) ->> 'id')::uuid as id
  from (values ('short', interval '50 minutes'), ('long', interval '50 minutes')) as n(name, d);
-- 'long' was created over 2 hours before its deadline; 'short' only 50 minutes before.
update picks set state = 'swiping' where id in (select id from pk);
update picks set created_at = now() - interval '130 minutes' where id = (select id from pk where name = 'long');
select is(
  (select array_agg(pick_id) from pick_reminder_targets(now(), now() + interval '1 hour')),
  array[(select id from pk where name = 'long')],
  'only a Pick open for over 2 hours gets "one hour left"');

-- ------------------------------------------------------------ push token cap
insert into push_tokens (token, user_id, platform, updated_at)
  select format('ExponentPushToken[t%s]', g), 'b1111111-1111-4111-8111-111111111111', 'ios',
    now() - make_interval(mins => g)
  from generate_series(1, 10) g;
select push_token_register('b1111111-1111-4111-8111-111111111111', 'ExponentPushToken[new]', 'ios');
select is((select count(*)::int from push_tokens where user_id = 'b1111111-1111-4111-8111-111111111111'),
  10, 'an 11th device keeps the account at 10');
select ok(not exists (select 1 from push_tokens where token = 'ExponentPushToken[t10]'),
  'the oldest device is the one dropped');

-- ------------------------------------------------------------ Did you go? after launch only
insert into groups (id, name, owner_id) values
  ('c0000000-0000-4000-8000-000000000001', 'Crew', 'b1111111-1111-4111-8111-111111111111');
insert into group_members (group_id, user_id, role) values
  ('c0000000-0000-4000-8000-000000000001', 'b1111111-1111-4111-8111-111111111111', 'owner'),
  ('c0000000-0000-4000-8000-000000000001', 'b2222222-2222-4222-8222-222222222222', 'member');
create temporary table done on commit drop as
  select (pick_create('b1111111-1111-4111-8111-111111111111', 'custom', 40.9, -73.1,
    1000, 20, null, 100) ->> 'id')::uuid as id;
insert into pick_participants (pick_id, user_id)
  select id, u from done, unnest(array['b2222222-2222-4222-8222-222222222222',
                                        'b3333333-3333-4333-8333-333333333333']::uuid[]) u;
insert into places (id, name, category, lat, lng) values ('fix-a', 'Alpha', 'food', 40.9, -73.1)
on conflict do nothing;
insert into pick_candidates (pick_id, place_id, snapshot)
  select id, 'fix-a', '{"name":"Alpha"}'::jsonb from done;
update picks set state = 'completed', decided_at = now() - interval '2 days',
  winner_place_id = 'fix-a', decided_by = 'clear_winner',
  group_id = 'c0000000-0000-4000-8000-000000000001', price_max = 2, open_now = true,
  include_saved = true, mix_category = 'food',
  custom_options = '[{"name":"Grandma''s"}]'::jsonb
where id = (select id from done);
select is((select count(*)::int from pick_plan_targets(now()) where pick_id = (select id from done)),
  0, 'a Pick decided before launch is never asked "Did you go?"');
update private.feature_launches set launched_at = now() - interval '3 days';
select is((select kind from pick_plan_targets(now()) where pick_id = (select id from done)),
  'did_you_go', 'one decided after launch is');

-- ------------------------------------------------------------ Pick again
create temporary table again on commit drop as
  select (pick_again((select id::text from done), 'b1111111-1111-4111-8111-111111111111') ->> 'id')::uuid as id;
select is(
  (select array[price_max::text, open_now::text, include_saved::text, mix_category, custom_options::text]
   from picks where id = (select id from again)),
  array['2', 'true', 'true', 'food', '[{"name": "Grandma''s"}]'],
  'filters and Custom Plan options are copied');
select is((select group_id from picks where id = (select id from again)),
  'c0000000-0000-4000-8000-000000000001'::uuid, 'the group is kept');
select is(
  (select array_agg(user_id order by user_id) from pick_participants where pick_id = (select id from again)),
  array['b1111111-1111-4111-8111-111111111111', 'b2222222-2222-4222-8222-222222222222']::uuid[],
  'someone no longer in the group is not added back');
select throws_ok(
  format($$select pick_again(%L, 'b2222222-2222-4222-8222-222222222222')$$, (select id from done)),
  'PT403', null, 'a guest still cannot pick again');

select * from finish();
rollback;
