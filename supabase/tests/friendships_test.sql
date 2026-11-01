-- Friends: requests, accept, remove, list, and who can read what (Mike, M3).
-- Run: supabase db reset && supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(31);

-- Fixtures: Ann and Bo become friends, Cy sends Ann a request, Di is a stranger.
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '71111111-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'friend-ann@test.invalid', '{"display_name":"Ann"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '72222222-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'friend-bo@test.invalid', '{"display_name":"Bo"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '73333333-3333-4333-8333-333333333333',
   'authenticated', 'authenticated', 'friend-cy@test.invalid', '{"display_name":"Cy"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '74444444-4444-4444-8444-444444444444',
   'authenticated', 'authenticated', 'friend-di@test.invalid', '{"display_name":"Di"}', now(), now());

-- ---------------------------------------------------------------- requests (as the API)
set local role service_role;
select is(
  friend_request('71111111-1111-4111-8111-111111111111', 'friend-bo@test.invalid'),
  '{"userId":"72222222-2222-4222-8222-222222222222","displayName":"Bo","status":"pending"}'::jsonb,
  'a request by email returns the person''s id, name and pending');
select is(
  friend_request('71111111-1111-4111-8111-111111111111', '  FRIEND-BO@test.invalid '),
  '{"userId":"72222222-2222-4222-8222-222222222222","displayName":"Bo","status":"pending"}'::jsonb,
  'asking again (any case, spaces trimmed) is idempotent');
select is((select count(*)::int from friendships), 1, 'asking twice leaves one row');

select throws_ok(
  $$select friend_request('71111111-1111-4111-8111-111111111111', 'nobody@test.invalid')$$,
  'PT404', null, 'an unknown email is rejected');
select throws_ok(
  $$select friend_request('71111111-1111-4111-8111-111111111111', 'friend-ann@test.invalid')$$,
  'PT400', null, 'you cannot add yourself');
select throws_ok(
  $$select friend_request('71111111-1111-4111-8111-111111111111', null)$$,
  'PT404', null, 'a null email is rejected');

select throws_ok(
  $$select friend_accept('71111111-1111-4111-8111-111111111111', '72222222-2222-4222-8222-222222222222')$$,
  'PT404', null, 'the requester cannot accept their own request');

-- Bo asks Ann back: that accepts Ann's request instead of making a second row.
select is(
  friend_request('72222222-2222-4222-8222-222222222222', 'friend-ann@test.invalid') ->> 'status',
  'accepted', 'asking someone who already asked you accepts');
select is((select count(*)::int from friendships), 1, 'mutual requests share one row');
select ok(
  (select accepted_at is not null from friendships
   where requester_id = '71111111-1111-4111-8111-111111111111'),
  'accepting sets accepted_at');
select is(
  friend_request('71111111-1111-4111-8111-111111111111', 'friend-bo@test.invalid') ->> 'status',
  'accepted', 'asking a friend again just says accepted');

-- Cy asks Ann; Ann accepts with friend_accept (twice is fine).
select lives_ok(
  $$select friend_request('73333333-3333-4333-8333-333333333333', 'friend-ann@test.invalid')$$,
  'Cy sends Ann a request');
select lives_ok(
  $$select friend_accept('71111111-1111-4111-8111-111111111111', '73333333-3333-4333-8333-333333333333')$$,
  'Ann accepts Cy');
select lives_ok(
  $$select friend_accept('71111111-1111-4111-8111-111111111111', '73333333-3333-4333-8333-333333333333')$$,
  'accepting twice is fine');
select throws_ok(
  $$select friend_accept('71111111-1111-4111-8111-111111111111', '74444444-4444-4444-8444-444444444444')$$,
  'PT404', null, 'accepting a request that does not exist is rejected');

-- Di asks Bo (stays pending).
select lives_ok(
  $$select friend_request('74444444-4444-4444-8444-444444444444', 'friend-bo@test.invalid')$$,
  'Di sends Bo a request');

-- ---------------------------------------------------------------- listing
select is(
  (select jsonb_agg(x ->> 'displayName' order by x ->> 'displayName')
   from jsonb_array_elements(friend_list('71111111-1111-4111-8111-111111111111')) x),
  '["Bo", "Cy"]'::jsonb, 'Ann''s list has Bo and Cy');
select is(
  (select x - 'createdAt' - 'acceptedAt'
   from jsonb_array_elements(friend_list('72222222-2222-4222-8222-222222222222')) x
   where x ->> 'displayName' = 'Di'),
  '{"userId":"74444444-4444-4444-8444-444444444444","displayName":"Di","status":"pending","direction":"in"}'::jsonb,
  'Bo sees Di''s request as incoming and pending');
select is(
  (select x ->> 'direction'
   from jsonb_array_elements(friend_list('74444444-4444-4444-8444-444444444444')) x),
  'out', 'Di sees the same request as outgoing');
select is(friend_list('00000000-0000-4000-8000-000000000000'), '[]'::jsonb,
  'someone with no friends gets an empty list');
reset role;

-- ---------------------------------------------------------------- RLS (as a client)
set local role authenticated;
set local request.jwt.claims to '{"sub":"74444444-4444-4444-8444-444444444444","role":"authenticated"}';
select is((select count(*)::int from friendships), 1, 'Di sees only her own row');
select is(
  (select display_name from profiles where id = '72222222-2222-4222-8222-222222222222'),
  'Bo', 'Di can read the name of someone she asked');
select is(
  (select count(*)::int from profiles where id = '71111111-1111-4111-8111-111111111111'),
  0, 'Di cannot read the profile of someone she has no row with');
select throws_ok(
  $$insert into friendships (requester_id, addressee_id) values (auth.uid(), '71111111-1111-4111-8111-111111111111')$$,
  '42501', null, 'clients cannot insert friendships');
select throws_ok(
  $$select friend_request(auth.uid(), 'friend-ann@test.invalid')$$,
  '42501', null, 'clients cannot call friend_request');
select throws_ok(
  $$select private.user_id_by_email('friend-ann@test.invalid')$$,
  '42501', null, 'clients cannot look people up by email');

set local request.jwt.claims to '{"sub":"71111111-1111-4111-8111-111111111111","role":"authenticated"}';
select is((select count(*)::int from friendships), 2, 'Ann sees her two friendships');
select is(
  (select count(*)::int from profiles where id in (
    '72222222-2222-4222-8222-222222222222', '73333333-3333-4333-8333-333333333333')),
  2, 'Ann can read her friends'' names');
select is(
  (select count(*)::int from friendships where requester_id = '74444444-4444-4444-8444-444444444444'),
  0, 'Ann cannot see Di''s request to Bo');
reset role;

-- ---------------------------------------------------------------- remove
set local role service_role;
select lives_ok(
  $$select friend_remove('71111111-1111-4111-8111-111111111111', '72222222-2222-4222-8222-222222222222'),
           friend_remove('72222222-2222-4222-8222-222222222222', '71111111-1111-4111-8111-111111111111')$$,
  'unfriending works and is idempotent');
select is(
  (select count(*)::int from friendships
   where '72222222-2222-4222-8222-222222222222' in (requester_id, addressee_id)
     and '71111111-1111-4111-8111-111111111111' in (requester_id, addressee_id)),
  0, 'the row is gone, so either person can ask again');
reset role;

select * from finish();
rollback;
