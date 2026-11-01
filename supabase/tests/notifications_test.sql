-- Notifications, push tokens, reminders and cancel reasons (Alan, M4; 0009_notifications.sql).
-- Run: supabase db reset && supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(23);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '91111111-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'n-host@test.invalid', '{"display_name":"Host"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '92222222-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'n-guest@test.invalid', '{"display_name":"Guest"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '93333333-3333-4333-8333-333333333333',
   'authenticated', 'authenticated', 'n-other@test.invalid', '{"display_name":"Other"}', now(), now());

create temporary table pk on commit drop as
  select name, (pick_create('91111111-1111-4111-8111-111111111111', 'food', 40.9126, -73.1234,
    1000, 20, null, 100) ->> 'id')::uuid as id
  from (values ('main'), ('soon'), ('later'), ('cancel')) as n(name);
grant select on pk to public;
insert into pick_participants (pick_id, user_id)
  select id, '92222222-2222-4222-8222-222222222222' from pk;

-- ---------------------------------------------------------------- notify_insert (as the API)
set local role service_role;
select is(
  (select count(*)::int from notify_insert(
    array['91111111-1111-4111-8111-111111111111', '92222222-2222-4222-8222-222222222222',
          '92222222-2222-4222-8222-222222222222']::uuid[],
    'winner_decided', (select id from pk where name = 'main'), '{}')),
  2, 'one row per person, duplicates in the input collapse');
select is(
  (select count(*)::int from notify_insert(
    array['91111111-1111-4111-8111-111111111111']::uuid[],
    'winner_decided', (select id from pk where name = 'main'), '{}')),
  0, 'the same Pick event never reaches a person twice');
select is(
  (select count(*)::int from notify_insert(
    array['91111111-1111-4111-8111-111111111111']::uuid[],
    'plan_time_set', (select id from pk where name = 'main'), '{}')
   ) + (select count(*)::int from notify_insert(
    array['91111111-1111-4111-8111-111111111111']::uuid[],
    'plan_time_set', (select id from pk where name = 'main'), '{}')),
  2, 'plan_time_set may repeat (the host can move the time)');
select is(
  (select count(*)::int from notify_insert(
    array['99999999-9999-4999-8999-999999999999']::uuid[],
    'pick_started', (select id from pk where name = 'main'), '{}')),
  0, 'an unknown (deleted) user is skipped, not an error');
select throws_ok(
  $$select notify_insert(array['91111111-1111-4111-8111-111111111111']::uuid[], 'made_up', null, '{}')$$,
  '23514', null, 'unknown notification types are rejected');
select throws_ok(
  format($$select notify_insert(array['91111111-1111-4111-8111-111111111111']::uuid[], 'pick_started', null, %L)$$,
    jsonb_build_object('x', repeat('y', 2000))),
  '23514', null, 'payloads are capped at 1 KB');

-- ---------------------------------------------------------------- reading (as clients)
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"92222222-2222-4222-8222-222222222222","role":"authenticated"}';
select is((select count(*)::int from notifications), 1, 'a user reads only their own notifications');
select throws_ok(
  $$insert into notifications (user_id, type) values ('92222222-2222-4222-8222-222222222222', 'pick_started')$$,
  '42501', null, 'clients cannot insert notifications');
select throws_ok(
  $$update notifications set read_at = now()$$,
  '42501', null, 'clients cannot update notifications (mark read goes through the API)');
select throws_ok($$select * from push_tokens$$, '42501', null, 'clients cannot read push tokens');
select throws_ok(
  $$select notify_insert(array[]::uuid[], 'pick_started', null, '{}')$$,
  '42501', null, 'clients cannot call notify_insert');
reset role;
set local role anon;
select throws_ok($$select * from notifications$$, '42501', null, 'anon cannot read notifications');

-- ---------------------------------------------------------------- mark read, push tokens
reset role;
set local role service_role;
select lives_ok(
  format($$select notification_mark_read(%L, '92222222-2222-4222-8222-222222222222')$$,
    (select id from notifications where user_id = '92222222-2222-4222-8222-222222222222' limit 1)),
  'the owner can mark a notification read');
select throws_ok(
  format($$select notification_mark_read(%L, '93333333-3333-4333-8333-333333333333')$$,
    (select id from notifications where user_id = '92222222-2222-4222-8222-222222222222' limit 1)),
  'PT404', null, 'someone else cannot mark it read');

select lives_ok(
  $$select push_token_register('91111111-1111-4111-8111-111111111111', 'ExponentPushToken[abc]', 'ios')$$,
  'a token registers');
select push_token_register('92222222-2222-4222-8222-222222222222', 'ExponentPushToken[abc]', 'ios');
select is(
  (select user_id from push_tokens where token = 'ExponentPushToken[abc]'),
  '92222222-2222-4222-8222-222222222222'::uuid,
  'a phone that signs in to another account moves to it');
select throws_ok(
  $$select push_token_register('91111111-1111-4111-8111-111111111111', 'not-a-token', 'ios')$$,
  '23514', null, 'malformed tokens are rejected');

select push_token_remove('91111111-1111-4111-8111-111111111111', 'ExponentPushToken[abc]');
select is((select count(*)::int from push_tokens where token = 'ExponentPushToken[abc]'), 1,
  'someone else cannot remove a token that is not theirs');
select push_token_remove('92222222-2222-4222-8222-222222222222', 'ExponentPushToken[abc]');
select is((select count(*)::int from push_tokens where token = 'ExponentPushToken[abc]'), 0,
  'the owner removes their token on sign-out');

-- ---------------------------------------------------------------- reminders
reset role;
update picks set state = 'swiping', deadline_at = now() + interval '30 minutes'
  where id = (select id from pk where name = 'soon');
update picks set state = 'swiping', deadline_at = now() + interval '3 hours'
  where id = (select id from pk where name = 'later');
update pick_participants set finished_at = now()
  where pick_id = (select id from pk where name = 'soon')
    and user_id = '91111111-1111-4111-8111-111111111111';
set local role service_role;
select is(
  (select user_ids from pick_reminder_targets(now(), now() + interval '1 hour')
   where pick_id = (select id from pk where name = 'soon')),
  array['92222222-2222-4222-8222-222222222222']::uuid[],
  'only unfinished participants of a Pick due within the hour are reminded');
select is(
  (select count(*)::int from pick_reminder_targets(now(), now() + interval '1 hour')
   where pick_id = (select id from pk where name = 'later')),
  0, 'a Pick due later is not reminded yet');
select notify_insert(array['92222222-2222-4222-8222-222222222222']::uuid[], 'reminder',
  (select id from pk where name = 'soon'), '{}');
select is(
  (select count(*)::int from pick_reminder_targets(now(), now() + interval '1 hour')),
  0, 'someone already reminded is not a target again');

-- ---------------------------------------------------------------- cancel reason
select pick_cancel((select id from pk where name = 'cancel')::text,
  '91111111-1111-4111-8111-111111111111', '  Rained out  ');
select is(
  (select cancel_reason from picks where id = (select id from pk where name = 'cancel')),
  'Rained out', 'pick_cancel stores the trimmed reason');

select * from finish();
rollback;
