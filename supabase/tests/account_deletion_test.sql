-- Account deletion (Razin, M4): 0017_account_deletion.sql.
-- Run: supabase db reset && supabase test db
--
-- Tables from open PRs (0008–0016) are checked when they exist and skipped otherwise,
-- so this file passes whichever of them have merged.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(56);

-- Test helpers: run SQL that names tables which may not exist yet.
create function pg_temp.n(p_sql text) returns integer language plpgsql as $$
declare v integer;
begin
  execute p_sql into v;
  return v;
end $$;
create function pg_temp.has(p_table text) returns boolean language sql as $$
  select to_regclass('public.' || p_table) is not null
$$;

-- ---------------------------------------------------------------- fixtures
-- A deletes their account. B and C are friends of A. D is only in one of B's Picks.
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000000a', 'a0000000-0000-4000-8000-00000000000a',
   'authenticated', 'authenticated', 'del-a@test.invalid', '{"display_name":"Ava"}', now(), now()),
  ('00000000-0000-0000-0000-00000000000a', 'b0000000-0000-4000-8000-00000000000b',
   'authenticated', 'authenticated', 'del-b@test.invalid', '{"display_name":"Ben"}', now(), now()),
  ('00000000-0000-0000-0000-00000000000a', 'c0000000-0000-4000-8000-00000000000c',
   'authenticated', 'authenticated', 'del-c@test.invalid', '{"display_name":"Cy"}', now(), now()),
  ('00000000-0000-0000-0000-00000000000a', 'd0000000-0000-4000-8000-00000000000d',
   'authenticated', 'authenticated', 'del-d@test.invalid', '{"display_name":"Dee"}', now(), now());

insert into places (id, name, category, lat, lng) values
  ('del-1', 'One', 'food', 40.91, -73.12), ('del-2', 'Two', 'food', 40.92, -73.13);

-- Picks, by name: a_* hosted by A, b_* hosted by B.
create temporary table pk (name text primary key, id uuid not null default gen_random_uuid(),
  host uuid not null, state pick_state not null, members uuid[] not null) on commit drop;
insert into pk (name, host, state, members) values
  ('a_solo',     'a0000000-0000-4000-8000-00000000000a', 'draft',     '{}'),
  ('a_draft',    'a0000000-0000-4000-8000-00000000000a', 'draft',     '{b0000000-0000-4000-8000-00000000000b}'),
  ('a_swiping',  'a0000000-0000-4000-8000-00000000000a', 'swiping',   '{b0000000-0000-4000-8000-00000000000b}'),
  ('a_vote',     'a0000000-0000-4000-8000-00000000000a', 'final_vote','{b0000000-0000-4000-8000-00000000000b}'),
  ('a_done',     'a0000000-0000-4000-8000-00000000000a', 'completed', '{b0000000-0000-4000-8000-00000000000b}'),
  ('a_canceled', 'a0000000-0000-4000-8000-00000000000a', 'canceled',  '{b0000000-0000-4000-8000-00000000000b}'),
  ('b_done',     'b0000000-0000-4000-8000-00000000000b', 'completed',
     '{a0000000-0000-4000-8000-00000000000a,c0000000-0000-4000-8000-00000000000c}'),
  ('b_swiping',  'b0000000-0000-4000-8000-00000000000b', 'swiping',
     '{a0000000-0000-4000-8000-00000000000a,d0000000-0000-4000-8000-00000000000d}');
grant select on pk to public;

insert into picks (id, host_id, category, center_lat, center_lng, radius_m)
  select id, host, 'food', 40.91, -73.12, 1000 from pk;
insert into pick_participants (pick_id, user_id)
  select id, host from pk union all select id, unnest(members) from pk;
insert into pick_candidates (pick_id, place_id, snapshot)
  select pk.id, p.id, jsonb_build_object('name', p.name, 'lat', p.lat, 'lng', p.lng)
  from pk cross join places p where pk.state <> 'draft' and p.id like 'del-%';
-- Everyone in a started Pick answered: del-1 Yes, del-2 No.
insert into preferences (pick_id, place_id, user_id, value)
  select pp.pick_id, c.place_id, pp.user_id, case c.place_id when 'del-1' then 2 else 0 end
  from pick_participants pp join pick_candidates c on c.pick_id = pp.pick_id
  where pp.pick_id in (select id from pk);
insert into ranking_results (pick_id, place_id, rank, finalist, score)
  select pk.id, c.place_id, case c.place_id when 'del-1' then 1 else 2 end, pk.state = 'final_vote',
         case c.place_id when 'del-1' then 90 else 10 end
  from pk join pick_candidates c on c.pick_id = pk.id where pk.state in ('completed', 'final_vote');
update picks p set state = pk.state from pk where pk.id = p.id and pk.state in ('swiping', 'canceled');
update picks p set state = 'final_vote', vote_deadline_at = now() + interval '1 hour'
  from pk where pk.id = p.id and pk.state = 'final_vote';
update picks p set state = 'completed', winner_place_id = 'del-1', decided_at = now(), decided_by = 'vote'
  from pk where pk.id = p.id and pk.state = 'completed';
insert into final_votes (pick_id, user_id, place_id)
  select (select id from pk where name = 'b_done'), u, 'del-1'
  from unnest(array['a0000000-0000-4000-8000-00000000000a', 'b0000000-0000-4000-8000-00000000000b']::uuid[]) u;

-- Rows in tables from open PRs, where they exist.
do $$
declare
  a constant uuid := 'a0000000-0000-4000-8000-00000000000a';
  b constant uuid := 'b0000000-0000-4000-8000-00000000000b';
  b_done uuid := (select id from pk where name = 'b_done');
  v_post uuid;
begin
  if pg_temp.has('friendships') then
    execute 'insert into public.friendships (requester_id, addressee_id, status, accepted_at)
             values ($1, $2, ''accepted'', now())' using a, b;
  end if;
  if pg_temp.has('push_tokens') then
    execute $q$insert into public.push_tokens (token, user_id, platform) values
      ('ExponentPushToken[del-a]', $1, 'ios'), ('ExponentPushToken[del-b]', $2, 'android')$q$ using a, b;
    execute $q$insert into public.notifications (user_id, type, pick_id) values ($1, 'winner_decided', $2)$q$
      using a, b_done;
  end if;
  if pg_temp.has('saved_places') then
    execute 'insert into public.saved_places (user_id, place_id) values ($1, ''del-1''), ($2, ''del-1'')' using a, b;
    execute $q$insert into public.rate_limit_counters (scope, subject, bucket, calls)
      values ('create', $1::text, 'today', 3), ('create', $2::text, 'today', 1)$q$ using a, b;
  end if;
  if pg_temp.has('groups') then
    execute $q$insert into public.groups (id, name, owner_id) values
      ('a6000000-0000-4000-8000-000000000001', 'A''s group', $1),
      ('b6000000-0000-4000-8000-000000000002', 'B''s group', $2)$q$ using a, b;
    execute $q$insert into public.group_members (group_id, user_id, role) values
      ('a6000000-0000-4000-8000-000000000001', $1, 'owner'), ('a6000000-0000-4000-8000-000000000001', $2, 'member'),
      ('b6000000-0000-4000-8000-000000000002', $2, 'owner'), ('b6000000-0000-4000-8000-000000000002', $1, 'member')$q$
      using a, b;
    -- B's Pick was started for A's group.
    execute 'update public.picks set group_id = ''a6000000-0000-4000-8000-000000000001'' where id = $1' using b_done;
  end if;
  if pg_temp.has('pick_rsvps') then
    execute 'insert into public.pick_rsvps (pick_id, user_id, status) values ($1, $2, ''going''), ($1, $3, ''going'')'
      using b_done, a, b;
    execute 'insert into public.pick_outcomes (pick_id, user_id, went) values ($1, $2, true)' using b_done, a;
  end if;
  if private.has_column('places', 'created_by') then
    -- A typed an option that B later used in b_done, and one that no Pick uses.
    execute $q$insert into public.places (id, name, category, lat, lng, raw) values
      ('custom:a0000000-0000-4000-8000-0000000000c1', 'A''s spot', 'custom', 40.9, -73.1,
       jsonb_build_object('provider', 'custom', 'createdBy', $1, 'name', 'A''s spot', 'lat', 40.9, 'lng', -73.1)),
      ('custom:a0000000-0000-4000-8000-0000000000c2', 'Unused', 'custom', 40.9, -73.1,
       jsonb_build_object('provider', 'custom', 'createdBy', $1, 'name', 'Unused', 'lat', 40.9, 'lng', -73.1))$q$
      using a;
    execute $q$insert into public.pick_candidates (pick_id, place_id, snapshot) select $2, id, raw
      from public.places where id = 'custom:a0000000-0000-4000-8000-0000000000c1'$q$ using a, b_done;
  end if;
  if pg_temp.has('hang_posts') then
    execute $q$insert into public.hang_posts (author_id, starts_at, expires_at, activity, audience)
      values ($1, now(), now() + interval '2 hours', 'Boba', 'all_friends')$q$ using a;
    execute $q$insert into public.hang_posts (author_id, starts_at, expires_at, activity, audience)
      values ($1, now(), now() + interval '2 hours', 'Bowling', 'all_friends') returning id$q$ into v_post using b;
    execute 'insert into public.hang_responses (post_id, user_id, status) values ($1, $2, ''down'')' using v_post, a;
  end if;
end $$;

create temporary table before_counts on commit drop as
  select pk.name,
    (select count(*) from ranking_results r where r.pick_id = pk.id) as ranks,
    (select count(*) from pick_candidates c where c.pick_id = pk.id) as candidates
  from pk;
grant select on before_counts to public;

-- ---------------------------------------------------------------- the bug (0002 trigger)
-- Auth deletes as supabase_auth_admin, which has no rights on public.picks. `supabase test
-- db` runs as postgres and can't become that role, so a role with only DELETE on profiles
-- stands in: the cascade into pick_participants used to fail with 42501.
create role wtw_test_deleter nologin;
grant wtw_test_deleter to current_user;
grant usage on schema public to wtw_test_deleter;
grant select, delete on public.profiles to wtw_test_deleter;
create policy "test only: deleter" on public.profiles for all to wtw_test_deleter using (true);
create temporary table bug_result (error text) on commit drop;
grant insert on bug_result to wtw_test_deleter;
set local role wtw_test_deleter;
do $$
begin
  delete from public.profiles where id = 'd0000000-0000-4000-8000-00000000000d';
  insert into bug_result values (null);
exception when others then
  insert into bug_result values (sqlstate || ': ' || sqlerrm);
end $$;
reset role;
select is((select error from bug_result), null,
  'a role without rights on picks can delete a user who is in a Pick');
select is((select count(*)::int from profiles where id = 'd0000000-0000-4000-8000-00000000000d'), 0,
  'and the profile really is gone');
select ok((select prosecdef from pg_proc where oid = 'private.bump_parent_pick_version()'::regprocedure),
  'the version-bump trigger runs as its owner');
select is((select state from picks where id = (select id from pk where name = 'b_swiping')), 'swiping',
  'D leaving does not change B''s Pick');

-- ---------------------------------------------------------------- delete A (as Auth does)
select lives_ok($$delete from auth.users where id = 'a0000000-0000-4000-8000-00000000000a'$$,
  'deleting an Auth user who hosts and joins Picks succeeds');

select is((select count(*)::int from profiles where id = 'a0000000-0000-4000-8000-00000000000a'), 0,
  'the profile is gone');
select is((select count(*)::int from pick_participants where user_id = 'a0000000-0000-4000-8000-00000000000a'), 0,
  'no participant rows are left');
select is((select count(*)::int from preferences where user_id = 'a0000000-0000-4000-8000-00000000000a'), 0,
  'no answers are left');
select is((select count(*)::int from final_votes where user_id = 'a0000000-0000-4000-8000-00000000000a'), 0,
  'no ballots are left');
select is((select count(*)::int from picks where host_id = 'a0000000-0000-4000-8000-00000000000a'), 0,
  'no Pick names A as host');

-- Hosted by A
select is((select count(*)::int from picks where id = (select id from pk where name = 'a_solo')), 0,
  'a hosted Pick nobody else is in is deleted');
select is(
  (select array_agg(picks.state::text order by pk.name) from picks join pk using (id)
   where pk.name in ('a_draft', 'a_swiping', 'a_vote')),
  array['canceled', 'canceled', 'canceled'], 'hosted unfinished Picks (draft, swiping, final vote) are canceled');
select is(
  (select count(*)::int from picks join pk using (id)
   where pk.name in ('a_draft', 'a_swiping', 'a_vote', 'a_done', 'a_canceled') and host_id is null),
  5, 'every kept hosted Pick has no host');
select is((select picks.state::text from picks where id = (select id from pk where name = 'a_done')), 'completed',
  'a hosted completed Pick is kept as completed');
select is((select winner_place_id from picks where id = (select id from pk where name = 'a_done')), 'del-1',
  'and keeps its winner');
select is((select count(*)::int from ranking_results where pick_id = (select id from pk where name = 'a_done')),
  (select ranks::int from before_counts where name = 'a_done'), 'and its ranking');
select is((select picks.state::text from picks where id = (select id from pk where name = 'a_canceled')), 'canceled',
  'a hosted Pick canceled earlier is kept');
select is(
  (select count(*)::int from pick_participants
   where pick_id = (select id from pk where name = 'a_done') and user_id = 'b0000000-0000-4000-8000-00000000000b'),
  1, 'the other participant stays in it');
select is(
  (select count(*)::int from preferences
   where pick_id = (select id from pk where name = 'a_swiping') and user_id = 'b0000000-0000-4000-8000-00000000000b'),
  2, 'the other participant keeps their own answers');

-- Hosted by B
select is(
  (select array_agg(picks.state::text order by pk.name) from picks join pk using (id) where pk.name in ('b_done', 'b_swiping')),
  array['completed', 'swiping'], 'other people''s Picks are untouched');
select is(
  (select count(*)::int from picks where host_id = 'b0000000-0000-4000-8000-00000000000b'), 2,
  'and keep their host');
select is((select count(*)::int from ranking_results where pick_id = (select id from pk where name = 'b_done')),
  (select ranks::int from before_counts where name = 'b_done'), 'B''s completed Pick keeps its ranking');
select is((select count(*)::int from pick_candidates where pick_id = (select id from pk where name = 'b_done')),
  (select candidates::int from before_counts where name = 'b_done'), 'and all of its candidates');
select is((select winner_place_id from picks where id = (select id from pk where name = 'b_done')), 'del-1',
  'and its winner');
select is(
  (select array_agg(user_id order by user_id) from pick_participants where pick_id = (select id from pk where name = 'b_done')),
  array['b0000000-0000-4000-8000-00000000000b', 'c0000000-0000-4000-8000-00000000000c']::uuid[],
  'only A left B''s completed Pick');
select is((select count(*)::int from final_votes where pick_id = (select id from pk where name = 'b_done')), 1,
  'B''s own ballot is kept');

-- ---------------------------------------------------------------- what clients can read
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated"}';
select is((select count(*)::int from picks), 0, 'a leftover token of A reads no Picks');
select is((select count(*)::int from profiles), 0, 'or profiles');
select is((select count(*)::int from preferences), 0, 'or answers');
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"b0000000-0000-4000-8000-00000000000b","role":"authenticated"}';
select is(
  (select picks.state::text from picks where id = (select id from pk where name = 'a_swiping')), 'canceled',
  'B sees A''s unfinished Pick as canceled');
select is(
  (select count(*)::int from picks where id in (select id from pk where name in ('a_done', 'b_done')) and state = 'completed'),
  2, 'B still sees both completed Picks');
select is((select count(*)::int from profiles where id = 'a0000000-0000-4000-8000-00000000000a'), 0,
  'B can no longer read A''s profile');
reset role;

-- ---------------------------------------------------------------- hostless Picks are read-only
select throws_ok(
  format('update picks set deadline_at = now() where id = %L', (select id from pk where name = 'a_done')),
  'PT409', null, 'a hostless Pick can''t be changed');
select lives_ok(
  format('update picks set version = version + 1 where id = %L', (select id from pk where name = 'a_done')),
  'its version can still move');
select throws_ok(
  format('update picks set host_id = null where id = %L', (select id from pk where name = 'b_swiping')),
  '23514', null, 'an unfinished Pick can''t lose its host');
set local role service_role;
select throws_ok(
  format('select pick_cancel(%L, %L)', (select id from pk where name = 'a_done'), 'b0000000-0000-4000-8000-00000000000b'),
  'PT409', null, 'host-only RPCs refuse a hostless Pick');
reset role;

-- ---------------------------------------------------------------- tables from open PRs
select case when not pg_temp.has('friendships') then skip('friendships (0008) not applied', 1)
  else is(pg_temp.n($$select count(*)::int from friendships where 'a0000000-0000-4000-8000-00000000000a' in (requester_id, addressee_id)$$),
    0, 'friendships are deleted') end;

select case when not pg_temp.has('push_tokens') then skip('push_tokens (0009) not applied', 5)
  else collect_tap(
    is(pg_temp.n($$select count(*)::int from push_tokens where user_id = 'a0000000-0000-4000-8000-00000000000a'$$),
      0, 'push tokens are deleted'),
    is(pg_temp.n($$select count(*)::int from push_tokens where user_id = 'b0000000-0000-4000-8000-00000000000b'$$),
      1, 'other people''s push tokens are kept'),
    is(pg_temp.n($$select count(*)::int from notifications where user_id = 'a0000000-0000-4000-8000-00000000000a'$$),
      0, 'notifications are deleted'),
    is(pg_temp.n(format($$select count(*)::int from notifications where user_id = 'b0000000-0000-4000-8000-00000000000b'
        and type = 'pick_canceled' and pick_id in (select id from pk where name in ('a_draft', 'a_swiping', 'a_vote'))
        and payload ->> 'reason' = %L$$, 'The host deleted their account.')),
      3, 'participants get a "canceled" inbox entry per canceled Pick'),
    is(pg_temp.n($$select count(*)::int from picks where cancel_reason = 'The host deleted their account.'$$),
      3, 'and the cancel reason says why')
  ) end;

select case when not pg_temp.has('saved_places') then skip('saved_places (0010) not applied', 2)
  else collect_tap(
    is(pg_temp.n($$select count(*)::int from saved_places where user_id = 'a0000000-0000-4000-8000-00000000000a'$$),
      0, 'saved places are deleted'),
    is(pg_temp.n($$select count(*)::int from rate_limit_counters where subject = 'a0000000-0000-4000-8000-00000000000a'$$),
      0, 'per-user rate-limit counters are deleted')
  ) end;

select case when not pg_temp.has('groups') then skip('groups (0012) not applied', 4)
  else collect_tap(
    is(pg_temp.n($$select count(*)::int from groups where id = 'a6000000-0000-4000-8000-000000000001'$$),
      0, 'a group they own is deleted'),
    is(pg_temp.n(format($$select count(*)::int from picks where id = %L and group_id is null$$, (select id from pk where name = 'b_done'))),
      1, 'the group''s Pick stays, without the group'),
    is(pg_temp.n($$select count(*)::int from groups where id = 'b6000000-0000-4000-8000-000000000002'$$),
      1, 'a group they were only in is kept'),
    is(pg_temp.n($$select count(*)::int from group_members where user_id = 'a0000000-0000-4000-8000-00000000000a'$$),
      0, 'their memberships are deleted')
  ) end;

select case when not pg_temp.has('pick_rsvps') then skip('RSVPs/outcomes (0013) not applied', 3)
  else collect_tap(
    is(pg_temp.n($$select count(*)::int from pick_rsvps where user_id = 'a0000000-0000-4000-8000-00000000000a'$$)
       + pg_temp.n($$select count(*)::int from pick_outcomes where user_id = 'a0000000-0000-4000-8000-00000000000a'$$),
      0, 'RSVPs and outcomes are deleted'),
    is(pg_temp.n($$select count(*)::int from pick_rsvps where user_id = 'b0000000-0000-4000-8000-00000000000b'$$),
      1, 'other people''s RSVPs are kept'),
    throws_ok(
      format($$insert into picks (host_id, category, center_lat, center_lng, radius_m, again_of)
               values ('b0000000-0000-4000-8000-00000000000b', 'food', 0, 0, 1000, %L)$$, (select id from pk where name = 'a_done')),
      'PT403', null, '"Pick again" of a hostless Pick is refused')
  ) end;

select case when not private.has_column('places', 'created_by') then skip('custom plans (0015) not applied', 3)
  else collect_tap(
    is(pg_temp.n(format($$select count(*)::int from pick_candidates where pick_id = %L
        and place_id = 'custom:a0000000-0000-4000-8000-0000000000c1' and created_by is null
        and not snapshot ? 'createdBy'$$, (select id from pk where name = 'b_done'))),
      1, 'a custom option they made stays in B''s Pick, without its creator'),
    is(pg_temp.n($$select count(*)::int from places where id = 'custom:a0000000-0000-4000-8000-0000000000c1'
        and created_by is null and not raw ? 'createdBy'$$),
      1, 'its place stays, without its creator'),
    is(pg_temp.n($$select count(*)::int from places where id = 'custom:a0000000-0000-4000-8000-0000000000c2'$$),
      0, 'a custom option no Pick uses is deleted')
  ) end;

select case when not pg_temp.has('hang_posts') then skip('hang posts (0016) not applied', 2)
  else collect_tap(
    is(pg_temp.n($$select count(*)::int from hang_posts where author_id = 'a0000000-0000-4000-8000-00000000000a'$$)
       + pg_temp.n($$select count(*)::int from hang_responses where user_id = 'a0000000-0000-4000-8000-00000000000a'$$),
      0, 'hang posts and responses are deleted'),
    is(pg_temp.n($$select count(*)::int from hang_posts where author_id = 'b0000000-0000-4000-8000-00000000000b'$$),
      1, 'other people''s hang posts are kept')
  ) end;

select * from finish();
rollback;
