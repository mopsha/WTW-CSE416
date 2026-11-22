-- Learning from Google places (0056_google_taste_signals.sql, Alan).
-- Run: supabase test db (after supabase db reset).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(27);

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

-- A skipped learning write queues the user; the sweep rebuilds from the saved actions.
-- (The two-connection lock case is in tests/db/taste_concurrency.py.)
reset role;
update pick_candidates set snapshot = snapshot || '{"tasteType":"thai_restaurant"}'
  where pick_id = (select id from gp) and place_id = 'c1';
insert into preferences (pick_id, place_id, user_id, value)
  values ((select id from gp), 'c1', (select host from sig), 0);
-- The No's write was "skipped": the old Yes is still there.
update taste_signals set weight = 1 where user_id = (select host from sig)
  and source = private.taste_source('swipe', (select id from gp), 'c1');
-- A Google signal that no longer matches its saved swipe (now No), and one that does (winner).
insert into taste_signals (user_id, source, place_type, weight, at, google) values
  ((select host from sig), private.taste_source('swipe', (select id from gp), 'g1'),
   'sushi_restaurant', 1, now() - interval '1 hour', true),
  ((select host from sig), private.taste_source('winner', (select id from gp), null),
   'sushi_restaurant', 2, (select decided_at from picks where id = (select id from gp)), true);
insert into private.taste_pending (user_id) values ((select host from sig)), ((select guest from sig));
set local role service_role;
select purge_google_taste(now() - interval '27 days');
reset role;
select is((select weight from taste_signals where user_id = (select host from sig)
  and source = private.taste_source('swipe', (select id from gp), 'c1')),
  -1::real, 'a skipped own-place No converges to the saved swipe on the next sweep');
select is((select count(*)::int from taste_signals where user_id = (select host from sig)
  and source = private.taste_source('swipe', (select id from gp), 'g1')),
  0, 'a Google signal that no longer matches its saved swipe is removed');
select is((select count(*)::int from taste_signals where user_id = (select host from sig)
  and source = private.taste_source('winner', (select id from gp), null)),
  1, 'a Google signal that still matches its saved action is kept');
select is((select count(*)::int from taste_signals where user_id = (select guest from sig)),
  0, 'a rebuild never brings back actions from before a reset');
select is((select count(*)::int from private.taste_pending), 0, 'the sweep drains the queue');

-- #78 re-review (Josh). Point 2: a reset that waited for the lock also clears what committed
-- while it waited, so the sweep can't bring it back. In this one-transaction test now() is the
-- start; this swipe is dated after it, like one that committed during the wait.
update preferences set value = 2, updated_at = clock_timestamp()
 where pick_id = (select id from gp) and place_id = 'c1' and user_id = (select host from sig);
select taste_reset((select host from sig));
insert into private.taste_pending (user_id) values ((select host from sig));
set local role service_role;
select purge_google_taste(now() - interval '27 days');
reset role;
select is((select count(*)::int from taste_signals where user_id = (select host from sig)),
  0, 'a reset clears actions that committed while it waited, and the sweep does not restore them');

-- Point 3: a change skipped behind the lock, then its Pick deleted before the sweep.
set local role service_role;
create temporary table gp2 on commit drop as
  select (pick_create(
    '81111111-1111-4111-8111-111111111111', 'food', 40.9126, -73.1234, 1000, 20, null, 100
  ) ->> 'id')::uuid as id;
insert into pick_participants (pick_id, user_id) values
  ((select id from gp2), '83333333-3333-4333-8333-333333333333');
select pick_start((select id::text from gp2), '81111111-1111-4111-8111-111111111111',
  '[{"placeId":"r1","snapshot":{"name":"Ramen","lat":0,"lng":0,"tasteType":"ramen_restaurant"}},
    {"placeId":"r2","snapshot":{"name":"Deli","lat":0,"lng":0,"tasteType":"deli"}}]'::jsonb);
select heartbeat_upsert_swipe((select id::text from gp2), '83333333-3333-4333-8333-333333333333', 'r1', 2);
select heartbeat_upsert_swipe((select id::text from gp2), '83333333-3333-4333-8333-333333333333', 'r2', 2);
reset role;
-- The Yes -> No on r1 is "skipped": the old +1 stays and the change is queued.
update preferences set value = 0 where pick_id = (select id from gp2) and place_id = 'r1'
  and user_id = '83333333-3333-4333-8333-333333333333';
update taste_signals set weight = 1 where user_id = '83333333-3333-4333-8333-333333333333'
  and source = private.taste_source('swipe', (select id from gp2), 'r1');
insert into private.taste_pending (user_id, source) values
  ('83333333-3333-4333-8333-333333333333', private.taste_source('swipe', (select id from gp2), 'r1'));
delete from picks where id = (select id from gp2);
set local role service_role;
select purge_google_taste(now() - interval '27 days');
reset role;
select is((select count(*)::int from taste_signals where user_id = '83333333-3333-4333-8333-333333333333'
  and source = private.taste_source('swipe', (select id from gp2), 'r1')),
  0, 'a queued change whose Pick was deleted does not leave the superseded Yes behind');
select is((select weight from taste_signals where user_id = '83333333-3333-4333-8333-333333333333'
  and source = private.taste_source('swipe', (select id from gp2), 'r2')),
  1::real, 'signals from a deleted Pick with nothing queued stay as history');

-- Point 1: a row queued while the sweep rebuilds that user is not deleted unprocessed. The
-- trigger stands in for another connection committing a skip during the rebuild; its row is
-- dated earlier, as a transaction that began before the sweep would date it.
create temporary table rebuild_flag (done boolean) on commit drop;
create function public.taste_test_queue_during_rebuild() returns trigger
language plpgsql as $f$
begin
  if not exists (select 1 from pg_temp.rebuild_flag) then
    insert into pg_temp.rebuild_flag values (true);
    insert into private.taste_pending (user_id, at)
      values ('83333333-3333-4333-8333-333333333333', now() - interval '1 hour');
  end if;
  return null;
end $f$;
-- On insert only: the sweep's own first statement (the 30-day purge) is a delete, before it reads the queue.
create trigger taste_test_queue_during_rebuild after insert on public.taste_signals
  for each statement execute function public.taste_test_queue_during_rebuild();
insert into private.taste_pending (user_id) values ('83333333-3333-4333-8333-333333333333');
set local role service_role;
select purge_google_taste(now() - interval '27 days');
reset role;
select is((select count(*)::int from private.taste_pending
  where user_id = '83333333-3333-4333-8333-333333333333'),
  1, 'a row queued during the rebuild waits for the next sweep instead of being deleted unread');
drop trigger taste_test_queue_during_rebuild on public.taste_signals;
set local role service_role;
select purge_google_taste(now() - interval '27 days');
reset role;
select is((select count(*)::int from private.taste_pending), 0, 'and the next sweep drains it');

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
