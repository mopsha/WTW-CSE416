-- Groups, Picks for a group, and inviting friends (Razin, M4).
-- Run: supabase db reset && supabase test db
--
-- Friends come from 0008_friendships.sql (PR #24). If it is not applied yet,
-- this test creates a stand-in with the same columns inside its transaction
-- (rolled back at the end), so it runs the same checks either way.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(55);

-- Fixtures: an owner, two friends, a pending request, and a stranger.
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '71111111-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'grp-owner@test.invalid', '{"display_name":"Owner"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '72222222-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'grp-ava@test.invalid', '{"display_name":"Ava"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '73333333-3333-4333-8333-333333333333',
   'authenticated', 'authenticated', 'grp-ben@test.invalid', '{"display_name":"Ben"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '74444444-4444-4444-8444-444444444444',
   'authenticated', 'authenticated', 'grp-pending@test.invalid', '{"display_name":"Pending"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '75555555-5555-4555-8555-555555555555',
   'authenticated', 'authenticated', 'grp-stranger@test.invalid', '{"display_name":"Stranger"}', now(), now());

-- ---------------------------------------------------------------- shape and grants
select has_table('public', 'groups', 'groups exists');
select has_table('public', 'group_members', 'group_members exists');
select has_column('public', 'picks', 'group_id', 'picks.group_id exists');
select ok((select relrowsecurity from pg_class where oid = 'public.groups'::regclass), 'RLS on groups');
select ok((select relrowsecurity from pg_class where oid = 'public.group_members'::regclass), 'RLS on group_members');
select ok(not has_table_privilege('authenticated', 'public.groups', 'insert')
  and not has_table_privilege('authenticated', 'public.groups', 'update')
  and not has_table_privilege('authenticated', 'public.groups', 'delete'), 'clients cannot write groups');
select ok(not has_table_privilege('authenticated', 'public.group_members', 'insert')
  and not has_table_privilege('authenticated', 'public.group_members', 'delete'), 'clients cannot write group_members');
select ok(not has_table_privilege('anon', 'public.groups', 'select'), 'anon cannot read groups');

-- Fail closed: nobody is a friend before a friendship row exists (and when 0008 is missing).
select ok(not private.are_friends('71111111-1111-4111-8111-111111111111', '72222222-2222-4222-8222-222222222222'),
  'are_friends is false without a friendship');

do $$
begin
  if to_regclass('public.friendships') is null then
    create table public.friendships (
      requester_id uuid not null references public.profiles (id) on delete cascade,
      addressee_id uuid not null references public.profiles (id) on delete cascade,
      status text not null default 'pending' check (status in ('pending', 'accepted')),
      primary key (requester_id, addressee_id)
    );
  end if;
end $$;
insert into public.friendships (requester_id, addressee_id, status) values
  ('71111111-1111-4111-8111-111111111111', '72222222-2222-4222-8222-222222222222', 'accepted'),
  ('73333333-3333-4333-8333-333333333333', '71111111-1111-4111-8111-111111111111', 'accepted'),
  ('71111111-1111-4111-8111-111111111111', '74444444-4444-4444-8444-444444444444', 'pending');

-- ---------------------------------------------------------------- create, name rules
-- Test bookkeeping only; the roles below must be able to read and add to it.
create temporary table g on commit drop as
  select (group_create('71111111-1111-4111-8111-111111111111', 'Roommates') ->> 'id')::uuid as id;
create temporary table pk (name text primary key, id uuid not null) on commit drop;
grant select, insert on g, pk to public;
set local role service_role;
select is((select owner_id from groups where id = (select id from g)),
  '71111111-1111-4111-8111-111111111111'::uuid, 'group_create sets the owner');
select is((select role from group_members where group_id = (select id from g)
  and user_id = '71111111-1111-4111-8111-111111111111'), 'owner', 'the owner is the first member, role owner');
select throws_ok($$select group_create('71111111-1111-4111-8111-111111111111', '')$$, 'PT400', null,
  'an empty name is rejected');
select throws_ok($$select group_create('71111111-1111-4111-8111-111111111111', repeat('x', 51))$$, 'PT400', null,
  'a 51-character name is rejected');
select lives_ok($$select group_create('71111111-1111-4111-8111-111111111111', repeat('x', 50))$$,
  'a 50-character name is fine');

-- ---------------------------------------------------------------- only friends can be added
select is(group_add_members('71111111-1111-4111-8111-111111111111', (select id from g),
  array['72222222-2222-4222-8222-222222222222', '73333333-3333-4333-8333-333333333333']::uuid[]), 2,
  'the owner adds two accepted friends (either direction)');
select throws_ok(format($$select group_add_members('71111111-1111-4111-8111-111111111111', %L,
  array['75555555-5555-4555-8555-555555555555']::uuid[])$$, (select id from g)), 'PT403', null,
  'a stranger cannot be added');
select throws_ok(format($$select group_add_members('71111111-1111-4111-8111-111111111111', %L,
  array['74444444-4444-4444-8444-444444444444']::uuid[])$$, (select id from g)), 'PT403', null,
  'a pending request is not a friend');
select throws_ok(format($$select group_add_members('72222222-2222-4222-8222-222222222222', %L,
  array['71111111-1111-4111-8111-111111111111']::uuid[])$$, (select id from g)), 'PT403', null,
  'a member who is not the owner cannot add people');
select throws_ok(format($$select group_add_members('75555555-5555-4555-8555-555555555555', %L,
  array['71111111-1111-4111-8111-111111111111']::uuid[])$$, (select id from g)), 'PT404', null,
  'a non-member gets not found');
select is(group_add_members('71111111-1111-4111-8111-111111111111', (select id from g),
  array['72222222-2222-4222-8222-222222222222']::uuid[]), 0, 'adding someone twice is a no-op');
select is((select count(*)::int from group_members where group_id = (select id from g)), 3,
  'rejected adds added nobody: owner + 2 friends');

-- ---------------------------------------------------------------- rename and owner rules
select throws_ok(format($$select group_rename('72222222-2222-4222-8222-222222222222', %L, 'Mine now')$$,
  (select id from g)), 'PT403', null, 'a member cannot rename');
select throws_ok(format($$select group_rename('75555555-5555-4555-8555-555555555555', %L, 'Mine now')$$,
  (select id from g)), 'PT404', null, 'a non-member cannot rename (not found)');
select lives_ok(format($$select group_rename('71111111-1111-4111-8111-111111111111', %L, 'The House')$$,
  (select id from g)), 'the owner renames');
select throws_ok(format($$select group_leave('71111111-1111-4111-8111-111111111111', %L)$$,
  (select id from g)), 'PT409', null, 'the owner cannot leave');
select throws_ok(format($$select group_remove_member('71111111-1111-4111-8111-111111111111', %L,
  '71111111-1111-4111-8111-111111111111')$$, (select id from g)), 'PT409', null, 'the owner cannot be removed');

-- ---------------------------------------------------------------- a Pick for the group
insert into pk select 'first', (pick_create('71111111-1111-4111-8111-111111111111', 'food', 40.91, -73.12,
    1000, 20, null, 100) ->> 'id')::uuid;
select is(pick_add_group((select id from pk where name = 'first'), '71111111-1111-4111-8111-111111111111',
  (select id from g)), 2, 'starting a Pick for the group adds every other member');
select is((select group_id from picks where id = (select id from pk where name = 'first')), (select id from g),
  'the Pick is labelled with the group');
select is((select count(*)::int from pick_participants where pick_id = (select id from pk where name = 'first')), 3,
  'host + 2 members are participants');
insert into pk select 'stranger', (pick_create('75555555-5555-4555-8555-555555555555', 'food', 40.91, -73.12,
  1000, 20, null, 100) ->> 'id')::uuid;
select throws_ok(format($$select pick_add_group(%L, '75555555-5555-4555-8555-555555555555', %L)$$,
  (select id from pk where name = 'stranger'), (select id from g)), 'PT404', null,
  'a non-member cannot start a Pick for the group');
select throws_ok(format($$select pick_add_group(%L, '72222222-2222-4222-8222-222222222222', %L)$$,
  (select id from pk where name = 'first'), (select id from g)), 'PT403', null,
  'only the host can add the group');

-- Finish the first Pick with a stored result.
select pick_start((select id::text from pk where name = 'first'), '71111111-1111-4111-8111-111111111111',
  '[{"placeId":"grp-1","snapshot":{"name":"One","lat":0,"lng":0}},
    {"placeId":"grp-2","snapshot":{"name":"Two","lat":0,"lng":0}}]'::jsonb);
reset role;
insert into ranking_results (pick_id, place_id, rank, finalist, score) values
  ((select id from pk where name = 'first'), 'grp-1', 1, false, 90.0);
update picks set state = 'completed', winner_place_id = 'grp-1', decided_at = now(), decided_by = 'clear_winner'
  where id = (select id from pk where name = 'first');

-- ---------------------------------------------------------------- RLS: members vs non-members
set local role authenticated;
set local request.jwt.claims to '{"sub":"73333333-3333-4333-8333-333333333333","role":"authenticated"}';
select is((select count(*)::int from groups where id = (select id from g)), 1, 'a member sees the group');
select is((select count(*)::int from group_members where group_id = (select id from g)), 3, 'a member sees every member');
select is((select display_name from profiles where id = '72222222-2222-4222-8222-222222222222'), 'Ava',
  'a member can read other members'' names');

set local request.jwt.claims to '{"sub":"75555555-5555-4555-8555-555555555555","role":"authenticated"}';
select is((select count(*)::int from groups where id = (select id from g)), 0, 'a non-member cannot see the group, even by id');
select is((select count(*)::int from group_members where group_id = (select id from g)), 0, 'a non-member sees no members');
select is((select count(*)::int from picks where group_id = (select id from g)), 0, 'a non-member sees none of the group''s Picks');
select is((select count(*)::int from ranking_results where pick_id = (select id from pk where name = 'first')), 0,
  'a non-member sees none of the group''s results');
select is((select count(*)::int from profiles where id = '72222222-2222-4222-8222-222222222222'), 0,
  'a non-member cannot read members'' profiles');
select throws_ok($$select group_create(auth.uid(), 'Hack')$$, '42501', null, 'clients cannot call group RPCs');
select throws_ok(format($$insert into group_members (group_id, user_id) values (%L, auth.uid())$$, (select id from g)),
  '42501', null, 'clients cannot insert themselves into a group');
reset role;

-- ---------------------------------------------------------------- removed member keeps the past, not the future
set local role service_role;
select lives_ok(format($$select group_remove_member('71111111-1111-4111-8111-111111111111', %L,
  '73333333-3333-4333-8333-333333333333')$$, (select id from g)), 'the owner removes Ben');
insert into pk select 'second', (pick_create('71111111-1111-4111-8111-111111111111', 'food', 40.91, -73.12,
  1000, 20, null, 100) ->> 'id')::uuid;
select is(pick_add_group((select id from pk where name = 'second'), '71111111-1111-4111-8111-111111111111',
  (select id from g)), 1, 'a new group Pick adds only current members');
select ok(not exists (select 1 from pick_participants where pick_id = (select id from pk where name = 'second')
  and user_id = '73333333-3333-4333-8333-333333333333'), 'the removed member is not in the new Pick');
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"73333333-3333-4333-8333-333333333333","role":"authenticated"}';
select is((select count(*)::int from groups where id = (select id from g)), 0, 'a removed member no longer sees the group');
select is((select state::text from picks where id = (select id from pk where name = 'first')), 'completed',
  'a removed member still sees the past Pick');
select is((select place_id from ranking_results where pick_id = (select id from pk where name = 'first') and rank = 1),
  'grp-1', 'a removed member keeps the past result');
select is((select count(*)::int from picks where id = (select id from pk where name = 'second')), 0,
  'a removed member cannot see the new Pick');
reset role;

-- ---------------------------------------------------------------- inviting individual friends
set local role service_role;
select is(pick_invite((select id from pk where name = 'second'), '71111111-1111-4111-8111-111111111111',
  array['73333333-3333-4333-8333-333333333333']::uuid[]), 1, 'the host invites a friend to a Pick');
select throws_ok(format($$select pick_invite(%L, '71111111-1111-4111-8111-111111111111',
  array['75555555-5555-4555-8555-555555555555']::uuid[])$$, (select id from pk where name = 'second')),
  'PT403', null, 'a stranger cannot be invited');
select throws_ok(format($$select pick_invite(%L, '72222222-2222-4222-8222-222222222222',
  array['73333333-3333-4333-8333-333333333333']::uuid[])$$, (select id from pk where name = 'second')),
  'PT403', null, 'only the host can invite');
select throws_ok(format($$select pick_invite(%L, '71111111-1111-4111-8111-111111111111',
  array['72222222-2222-4222-8222-222222222222']::uuid[])$$, (select id from pk where name = 'first')),
  'PT409', null, 'nobody can be invited once a Pick is decided');

-- ---------------------------------------------------------------- leave and delete
select lives_ok(format($$select group_leave('72222222-2222-4222-8222-222222222222', %L)$$, (select id from g)),
  'a member leaves');
select lives_ok(format($$select group_delete('71111111-1111-4111-8111-111111111111', %L)$$, (select id from g)),
  'the owner deletes the group');
select is((select count(*)::int from pick_participants where pick_id = (select id from pk where name = 'first')), 3,
  'deleting the group keeps past Picks and their participants');
reset role;

select * from finish();
rollback;
