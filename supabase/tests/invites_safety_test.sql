-- Invites and safety (Razin, M4): 0014_invites_safety.sql.
-- Run: supabase db reset && supabase test db
--
-- Friendships (0008) and groups (0012) sections are checked when those tables exist and
-- skipped otherwise, so this file passes with or without PRs #24 and #30.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(82);

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
-- 40 people: u(1) hosts, u(2) is a guest, u(3) a stranger, the rest fill a Pick to its cap
-- and give each rate-limit check its own fresh user.
create function pg_temp.u(i integer) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid
$$;
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', pg_temp.u(i), 'authenticated', 'authenticated',
       'safety-' || i || '@test.invalid', jsonb_build_object('display_name', 'User ' || i), now(), now()
from generate_series(1, 40) i;

create temporary table pk on commit drop as
  select name, (pick_create(pg_temp.u(1), 'food', 40.9, -73.1, 1000, 20, null, 100) ->> 'id')::uuid as id
  from (values ('main'), ('locked'), ('full'), ('done'), ('blocked'), ('links')) as n(name);
create temporary table codes on commit drop as
  select pk.name, j.code from pk join pick_join_codes j on j.pick_id = pk.id;
grant select on pk, codes to public;
create function pg_temp.pick(p_name text) returns uuid language sql as $$ select id from pk where name = p_name $$;
create function pg_temp.code(p_name text) returns text language sql as $$ select code from codes where name = p_name $$;
create function pg_temp.failures(p_user uuid) returns integer language sql as $$
  select count(*)::integer from join_attempts where user_id = p_user
$$;

-- ---------------------------------------------------------------- joining by code
select is(pick_join(pg_temp.code('main'), pg_temp.u(2)) ->> 'pickId', pg_temp.pick('main')::text,
  'a valid code joins');
select is(pg_temp.failures(pg_temp.u(2)), 0, 'a successful join is not counted as a failure');

update picks set state = 'completed' where id = pg_temp.pick('done');
select is(
  array[
    pick_join('ZZZZZZ', pg_temp.u(4)),
    pick_join(pg_temp.code('done'), pg_temp.u(4))
  ],
  array['{"ok": false, "reason": "invalid"}'::jsonb, '{"ok": false, "reason": "invalid"}'::jsonb],
  'an unknown code and a closed Pick answer exactly the same');
select is(pg_temp.failures(pg_temp.u(4)), 2, 'each failed join is recorded');

-- Lock the lobby: host only, while joinable.
select throws_ok(format('select pick_set_lobby_locked(%L, %L, true)', pg_temp.pick('locked'), pg_temp.u(2)),
  'PT404', null, 'someone outside the Pick cannot lock it');
select pick_join(pg_temp.code('locked'), pg_temp.u(2));
select throws_ok(format('select pick_set_lobby_locked(%L, %L, true)', pg_temp.pick('locked'), pg_temp.u(2)),
  'PT403', null, 'a guest cannot lock the lobby');
select throws_ok(format('select pick_set_lobby_locked(%L, %L, true)', pg_temp.pick('done'), pg_temp.u(1)),
  'PT409', null, 'a finished Pick cannot be locked');
select is(pick_set_lobby_locked(pg_temp.pick('locked')::text, pg_temp.u(1), true), true, 'the host locks the lobby');
select is(pick_join(pg_temp.code('locked'), pg_temp.u(5)) ->> 'reason', 'invalid',
  'a locked lobby admits nobody new, with the same answer');
select is(pick_join(pg_temp.code('locked'), pg_temp.u(2)) ->> 'pickId', pg_temp.pick('locked')::text,
  'someone already in a locked Pick can still reopen it by code');
select pick_set_lobby_locked(pg_temp.pick('locked')::text, pg_temp.u(1), false);
select is(pick_join(pg_temp.code('locked'), pg_temp.u(5)) ->> 'pickId', pg_temp.pick('locked')::text,
  'unlocking lets people in again');

-- Participant cap: 30.
insert into pick_participants (pick_id, user_id)
  select pg_temp.pick('full'), pg_temp.u(i) from generate_series(2, 30) i;
select is((select count(*)::int from pick_participants where pick_id = pg_temp.pick('full')), 30,
  'a Pick holds 30 people');
select is(pick_join(pg_temp.code('full'), pg_temp.u(31)) ->> 'reason', 'invalid',
  'joining a full Pick gets the same answer');
select throws_ok(format('insert into pick_participants (pick_id, user_id) values (%L, %L)', pg_temp.pick('full'), pg_temp.u(32)),
  'PT409', 'This Pick is full', 'no path can add a 31st person');

-- Brute force: 10 failures an hour, then rate limited even with a valid code.
select pick_join('AAAAA' || i, pg_temp.u(6)) from generate_series(2, 9) i;   -- 8 failures
select pick_join('ZZZZZZ', pg_temp.u(6)), pick_join('YYYYYY', pg_temp.u(6)); -- 10
select is(pg_temp.failures(pg_temp.u(6)), 10, 'ten failures are recorded');
select is(pick_join(pg_temp.code('main'), pg_temp.u(6)), '{"ok": false, "reason": "rate_limited"}'::jsonb,
  'the 11th try is rate limited, even with a valid code');
select is(pg_temp.failures(pg_temp.u(6)), 10, 'a rate-limited try is not recorded');
update join_attempts set created_at = now() - interval '61 minutes' where user_id = pg_temp.u(6);
select is(pick_join(pg_temp.code('main'), pg_temp.u(6)) ->> 'ok', 'true', 'after an hour they can join again');

-- ---------------------------------------------------------------- blocking
select throws_ok(format('select block_user(%L, %L)', pg_temp.u(1), pg_temp.u(1)), 'PT400', null,
  'nobody can block themselves');
select throws_ok(format('select block_user(%L, %L)', pg_temp.u(1), gen_random_uuid()), 'PT404', null,
  'blocking an unknown user is not found');
select lives_ok(format('select block_user(%L, %L)', pg_temp.u(1), pg_temp.u(7)), 'the host blocks user 7');
select lives_ok(format('select block_user(%L, %L)', pg_temp.u(1), pg_temp.u(7)), 'blocking twice is fine');
select lives_ok(format('select block_user(%L, %L)', pg_temp.u(8), pg_temp.u(1)), 'user 8 blocks the host');

select is(pick_join(pg_temp.code('blocked'), pg_temp.u(7)) ->> 'reason', 'invalid',
  'someone the host blocked cannot join by code, and is not told why');
select is(pick_join(pg_temp.code('blocked'), pg_temp.u(8)) ->> 'reason', 'invalid',
  'someone who blocked the host cannot join either');
insert into pick_participants (pick_id, user_id) values (pg_temp.pick('blocked'), pg_temp.u(7));
select is((select count(*)::int from pick_participants where pick_id = pg_temp.pick('blocked') and user_id = pg_temp.u(7)), 0,
  'no other path adds a blocked person (the row is skipped)');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*)::int from blocks), 1, 'the blocker reads their own blocks');
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-000000000007","role":"authenticated"}';
select is((select count(*)::int from blocks), 0, 'the blocked person never sees that they were blocked');
select throws_ok(format('insert into blocks values (%L, %L)', pg_temp.u(7), pg_temp.u(1)), '42501', null,
  'clients cannot write blocks');
reset role;

select lives_ok(format('select unblock_user(%L, %L)', pg_temp.u(1), pg_temp.u(7)), 'the host unblocks user 7');
select is(pick_join(pg_temp.code('blocked'), pg_temp.u(7)) ->> 'ok', 'true', 'after unblocking they can join');

-- ---------------------------------------------------------------- friend request limit
select is((select count(*)::int from generate_series(1, 20) where rate_limit_take(pg_temp.u(9), 'friend_request')), 20,
  'twenty friend requests a day are allowed');
select is(rate_limit_take(pg_temp.u(9), 'friend_request'), false, 'the 21st is refused');
select is(rate_limit_take(pg_temp.u(10), 'friend_request'), true, 'the limit is per user');
select throws_ok(format('select rate_limit_take(%L, %L)', pg_temp.u(10), 'report'), 'PT400', null,
  'only API-side limits can be taken directly');

-- ---------------------------------------------------------------- reports
select ok(report_create(pg_temp.u(2), 'user', pg_temp.u(1), 'Rude in the lobby') is not null, 'a person can be reported');
select ok(report_create(pg_temp.u(2), 'pick', pg_temp.pick('main'), 'Spam') is not null, 'a Pick I am in can be reported');
select throws_ok(format('select report_create(%L, %L, %L, %L)', pg_temp.u(3), 'pick', pg_temp.pick('main'), 'x'),
  'PT404', null, 'a Pick I am not in cannot be reported (and is not confirmed to exist)');
select throws_ok(format('select report_create(%L, %L, %L, %L)', pg_temp.u(2), 'user', pg_temp.u(2), 'x'),
  'PT404', null, 'nobody reports themselves');
select throws_ok(format('select report_create(%L, %L, %L, %L)', pg_temp.u(2), 'user', gen_random_uuid(), 'x'),
  'PT404', null, 'an unknown user cannot be reported');
select throws_ok(format('select report_create(%L, %L, %L, %L)', pg_temp.u(2), 'user', pg_temp.u(1), '   '),
  'PT400', null, 'a report needs a reason');
select throws_ok(format('select report_create(%L, %L, %L, %L)', pg_temp.u(2), 'place', pg_temp.u(1), 'x'),
  'PT400', null, 'only people, Picks and groups can be reported');
select is((select count(*)::int from generate_series(1, 10) where report_create(pg_temp.u(11), 'user', pg_temp.u(1), 'r') is not null), 10,
  'ten reports a day are allowed');
select throws_ok(format('select report_create(%L, %L, %L, %L)', pg_temp.u(11), 'user', pg_temp.u(1), 'r'),
  'PT429', null, 'the 11th report is rate limited');

-- ---------------------------------------------------------------- invite links
create temporary table links (name text primary key, token text) on commit drop;
grant select on links to public;
insert into links values ('main', invite_create(pg_temp.u(1), 'pick', pg_temp.pick('links'), null) ->> 'token');
insert into links values ('once', invite_create(pg_temp.u(1), 'pick', pg_temp.pick('links'), 1) ->> 'token');
insert into links values ('revoked', invite_create(pg_temp.u(1), 'pick', pg_temp.pick('links'), null) ->> 'token');
insert into links values ('expired', invite_create(pg_temp.u(1), 'pick', pg_temp.pick('links'), null) ->> 'token');
create function pg_temp.link(p_name text) returns text language sql as $$ select token from links where name = p_name $$;

select is((select count(*)::int from links where token ~ '^[A-Za-z0-9_-]{22}$'), 4,
  'tokens are 22 URL-safe characters (128 bits)');
select is((select count(distinct token)::int from links), 4, 'every token is different');
select ok((select bool_and(expires_at between now() + interval '7 days' - interval '1 minute'
                                         and now() + interval '7 days' + interval '1 minute')
           from invite_links), 'links expire in 7 days');
select throws_ok(format('select invite_create(%L, %L, %L, null)', pg_temp.u(2), 'pick', pg_temp.pick('main')),
  'PT403', null, 'only the host makes Pick invite links');
select throws_ok(format('select invite_create(%L, %L, %L, null)', pg_temp.u(3), 'pick', pg_temp.pick('main')),
  'PT404', null, 'a stranger gets not found');
select throws_ok(format('select invite_create(%L, %L, %L, null)', pg_temp.u(1), 'pick', pg_temp.pick('done')),
  'PT409', null, 'a finished Pick gets no new links');
select throws_ok(format('select invite_create(%L, %L, %L, 0)', pg_temp.u(1), 'pick', pg_temp.pick('main')),
  'PT400', null, 'max uses is 1 to 100');

select is(invite_accept(pg_temp.link('main'), pg_temp.u(12)) ->> 'targetId', pg_temp.pick('links')::text,
  'accepting a link joins the Pick');
select is((select uses from invite_links where token = pg_temp.link('main')), 1, 'and uses it once');
select is(invite_accept(pg_temp.link('main'), pg_temp.u(12)) ->> 'ok', 'true', 'accepting again is fine');
select is((select uses from invite_links where token = pg_temp.link('main')), 1, 'and does not use it again');

select is(invite_accept(pg_temp.link('once'), pg_temp.u(13)) ->> 'ok', 'true', 'a one-use link works once');
select is(invite_accept(pg_temp.link('once'), pg_temp.u(14)) ->> 'reason', 'invalid', 'and then no more');

select throws_ok(format('select invite_revoke(%L, %L)', pg_temp.link('revoked'), pg_temp.u(2)), 'PT404', null,
  'only the creator revokes a link');
select lives_ok(format('select invite_revoke(%L, %L)', pg_temp.link('revoked'), pg_temp.u(1)), 'the creator revokes it');
select lives_ok(format('select invite_revoke(%L, %L)', pg_temp.link('revoked'), pg_temp.u(1)), 'revoking twice is fine');
select is(invite_accept(pg_temp.link('revoked'), pg_temp.u(15)) ->> 'reason', 'invalid', 'a revoked link is refused');
update invite_links set expires_at = now() - interval '1 second' where token = pg_temp.link('expired');
select is(invite_accept(pg_temp.link('expired'), pg_temp.u(15)) ->> 'reason', 'invalid', 'an expired link is refused');
select is(invite_accept('AAAAAAAAAAAAAAAAAAAAAA', pg_temp.u(15)) ->> 'reason', 'invalid', 'an unknown token is refused');
select is((select count(*)::int from join_attempts where user_id = pg_temp.u(15) and via = 'link'), 3,
  'failed links count toward the same join limit');

select block_user(pg_temp.u(16), pg_temp.u(1));
select is(invite_accept(pg_temp.link('main'), pg_temp.u(16)) ->> 'reason', 'invalid',
  'someone who blocked the link''s creator cannot use it');
select pick_set_lobby_locked(pg_temp.pick('links')::text, pg_temp.u(1), true);
select is(invite_accept(pg_temp.link('main'), pg_temp.u(17)) ->> 'reason', 'invalid', 'a locked lobby refuses links');
select pick_set_lobby_locked(pg_temp.pick('links')::text, pg_temp.u(1), false);

insert into join_attempts (user_id, via) select pg_temp.u(18), 'code' from generate_series(1, 10);
select is(invite_accept(pg_temp.link('main'), pg_temp.u(18)), '{"ok": false, "reason": "rate_limited"}'::jsonb,
  'ten failed joins by code also rate-limit links');

select is((select count(*)::int from generate_series(1, 16)
           where invite_create(pg_temp.u(1), 'pick', pg_temp.pick('links'), null) is not null), 16,
  'twenty links a day (4 made above)');
select throws_ok(format('select invite_create(%L, %L, %L, null)', pg_temp.u(1), 'pick', pg_temp.pick('links')),
  'PT429', null, 'the 21st link is rate limited');

-- ---------------------------------------------------------------- client access
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*)::int from invite_links), 20, 'the creator reads their own links');
select throws_ok('select count(*) from reports', '42501', null, 'clients cannot read reports');
select throws_ok('select count(*) from join_attempts', '42501', null, 'clients cannot read join attempts');
select throws_ok(format('select invite_accept(%L, auth.uid())', pg_temp.link('main')), '42501', null,
  'clients cannot accept links directly');
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*)::int from invite_links), 0, 'nobody else reads them');
reset role;

-- ---------------------------------------------------------------- friendships (0008)
do $$
begin
  if pg_temp.has('friendships') then
    perform friend_request(pg_temp.u(19), 'safety-20@test.invalid');
  end if;
end $$;
select case when not pg_temp.has('friendships') then skip('friendships (0008) not applied', 1)
  else is(pg_temp.n(format('select count(*)::int from friendships where requester_id = %L', pg_temp.u(19))), 1,
    'friend requests still work') end;
select block_user(pg_temp.u(20), pg_temp.u(19));
select case when not pg_temp.has('friendships') then skip('friendships (0008) not applied', 1)
  else is(pg_temp.n(format('select count(*)::int from friendships where %L in (requester_id, addressee_id)', pg_temp.u(19))), 0,
    'blocking ends the friendship request') end;
do $$
begin
  if pg_temp.has('friendships') then
    perform friend_request(pg_temp.u(19), 'safety-20@test.invalid');
    perform friend_request(pg_temp.u(20), 'safety-19@test.invalid');
  end if;
end $$;
select case when not pg_temp.has('friendships') then skip('friendships (0008) not applied', 1)
  else is(pg_temp.n(format('select count(*)::int from friendships where %L in (requester_id, addressee_id)', pg_temp.u(19))), 0,
    'new requests between them, either way, are silently dropped') end;

-- ---------------------------------------------------------------- groups (0012)
select block_user(pg_temp.u(22), pg_temp.u(21));
do $$
declare
  v_group uuid;
begin
  if pg_temp.has('groups') then
    v_group := (group_create(pg_temp.u(21), 'Safety') ->> 'id')::uuid;
    insert into group_members (group_id, user_id) values (v_group, pg_temp.u(22));
    perform invite_accept(invite_create(pg_temp.u(21), 'group', v_group, null) ->> 'token', pg_temp.u(23));
    perform invite_accept(invite_create(pg_temp.u(21), 'group', v_group, null) ->> 'token', pg_temp.u(22));
  end if;
end $$;
select case when not pg_temp.has('groups') then skip('groups (0012) not applied', 3)
  else collect_tap(
    is(pg_temp.n(format('select count(*)::int from group_members where user_id = %L', pg_temp.u(22))), 0,
      'an owner cannot add someone who blocked them, by hand or by link'),
    is(pg_temp.n(format('select count(*)::int from group_members where user_id = %L', pg_temp.u(23))), 1,
      'a group link adds someone'),
    throws_ok(format('select invite_create(%L, %L, (select group_id from group_members where user_id = %L), null)',
      pg_temp.u(23), 'group', pg_temp.u(23)), 'PT403', null, 'only the owner makes group links')
  ) end;
select case when pg_temp.has('groups') then skip('groups (0012) applied', 2)
  else collect_tap(
    throws_ok(format('select invite_create(%L, %L, %L, null)', pg_temp.u(21), 'group', gen_random_uuid()),
      'PT404', null, 'without groups, group links are not found'),
    throws_ok(format('select report_create(%L, %L, %L, %L)', pg_temp.u(21), 'group', gen_random_uuid(), 'x'),
      'PT404', null, 'without groups, a group cannot be reported')
  ) end;

select * from finish();
rollback;
