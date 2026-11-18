-- Learning from Google places (0051_google_taste_signals.sql, Alan).
-- Run: supabase test db (after supabase db reset).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(17);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '81111111-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'gt-host@test.invalid', '{"display_name":"Host"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '82222222-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'gt-guest@test.invalid', '{"display_name":"Guest"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '83333333-3333-4333-8333-333333333333',
   'authenticated', 'authenticated', 'gt-out@test.invalid', '{"display_name":"Outsider"}', now(), now());

set local role service_role;

create temporary table gp on commit drop as
  select (pick_create(
    '81111111-1111-4111-8111-111111111111', 'food', 40.9126, -73.1234, 1000, 20, null, 100
  ) ->> 'id')::uuid as id;
insert into pick_participants (pick_id, user_id) values
  ((select id from gp), '82222222-2222-4222-8222-222222222222');
select pick_start((select id::text from gp), '81111111-1111-4111-8111-111111111111',
  '[{"placeId":"g1","snapshot":{"placeId":"g1","name":null,"category":"food","lat":0,"lng":0,"provider":"google"}},
    {"placeId":"c1","snapshot":{"name":"Custom","lat":0,"lng":0}}]'::jsonb);

create temporary table sig on commit drop as
  select '81111111-1111-4111-8111-111111111111'::uuid as host,
         '82222222-2222-4222-8222-222222222222'::uuid as guest;

-- Swipes: the weight comes from the saved swipe; the API only supplies the live type.
select heartbeat_upsert_swipe((select id::text from gp), (select host from sig), 'g1', 2);
select taste_record_google_signal((select host from sig), (select id::text from gp), 'g1', 'swipe', 'sushi_restaurant');
select is((select score from learned_taste where user_id = (select host from sig)
  and place_type = 'sushi_restaurant'), 1::real, 'a Google Yes swipe teaches +1');
select ok((select google from taste_signals where user_id = (select host from sig)),
  'signals learned from Google places are marked, for the 30-day limit');

select heartbeat_upsert_swipe((select id::text from gp), (select host from sig), 'g1', 0);
select taste_record_google_signal((select host from sig), (select id::text from gp), 'g1', 'swipe', 'sushi_restaurant');
select is((select score from learned_taste where user_id = (select host from sig)
  and place_type = 'sushi_restaurant'), -1::real, 'changing it to No replaces the signal');
select is((select count(*)::int from taste_signals where user_id = (select host from sig)),
  1, 'one signal per swiped place, not one per request');

select taste_record_google_signal((select guest from sig), (select id::text from gp), 'g1', 'swipe', 'pizza_restaurant');
select is((select count(*)::int from taste_signals where user_id = (select guest from sig)),
  0, 'no saved swipe, no signal');

select taste_record_google_signal('83333333-3333-4333-8333-333333333333', (select id::text from gp), 'g1', 'swipe', 'sushi_restaurant');
select is((select count(*)::int from taste_signals where user_id = '83333333-3333-4333-8333-333333333333'),
  0, 'a non-participant is ignored');

select heartbeat_upsert_swipe((select id::text from gp), (select guest from sig), 'c1', 2);
select taste_record_google_signal((select guest from sig), (select id::text from gp), 'c1', 'swipe', 'thai_restaurant');
select is((select count(*)::int from taste_signals where user_id = (select guest from sig)),
  0, 'non-Google places are ignored here (they learn from their stored type)');

select taste_record_google_signal((select guest from sig), (select id::text from gp), 'g1', 'vote', 'sushi_restaurant');
select is((select count(*)::int from taste_signals where user_id = (select guest from sig)),
  0, 'a vote that was never cast is ignored');

select lives_ok(
  $$select taste_record_google_signal('82222222-2222-4222-8222-222222222222', 'not-a-pick', 'g1', 'swipe', 'cafe')$$,
  'junk input never raises');

-- Winners: recorded on the next read, dated to the decision, never past 30 days or a reset.
update picks set state = 'completed', winner_place_id = 'g1', decided_at = now() - interval '40 days',
  decided_by = 'clear_winner' where id = (select id from gp);
select taste_record_google_signal((select guest from sig), (select id::text from gp), 'g1', 'winner', 'sushi_restaurant');
select is((select count(*)::int from taste_signals where user_id = (select guest from sig)),
  0, 'a Google winner older than 30 days is not learned');
update picks set decided_at = now() - interval '10 days' where id = (select id from gp);
select taste_record_google_signal((select guest from sig), (select id::text from gp), 'g1', 'winner', 'sushi_restaurant');
select is((select weight from taste_signals where user_id = (select guest from sig)),
  2::real, 'a Google winner teaches +2');
select ok((select at < now() - interval '9 days' from taste_signals where user_id = (select guest from sig)),
  'the winner signal is dated to the decision, so an old Pick adds a faded signal');

-- Google-derived signals are hidden after 30 days and deleted by the sweep's purge.
update taste_signals set at = now() - interval '31 days' where user_id = (select host from sig);
select is((select count(*)::int from learned_taste where user_id = (select host from sig)),
  0, 'an expired Google signal no longer counts');
select is(purge_google_taste(now() - interval '27 days'), 1, 'the sweep purge deletes it');

select taste_reset((select guest from sig));
select taste_record_google_signal((select guest from sig), (select id::text from gp), 'g1', 'winner', 'sushi_restaurant');
select is((select count(*)::int from taste_signals where user_id = (select guest from sig)),
  0, 'after a reset, opening an older Pick does not teach again');

-- Clients can't call either function.
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"82222222-2222-4222-8222-222222222222","role":"authenticated"}';
select throws_ok($$select taste_record_google_signal('82222222-2222-4222-8222-222222222222', null, 'g1', 'swipe', 'cafe')$$,
  '42501', null, 'clients cannot record signals');
select throws_ok($$select taste_reset('81111111-1111-4111-8111-111111111111')$$,
  '42501', null, 'clients cannot reset anyone''s learning');

select * from finish();
rollback;
