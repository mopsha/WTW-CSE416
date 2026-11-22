-- Password login limits (0057_password_login_limit.sql, Alan).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(18);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '91111111-1111-4111-8111-111111111111',
  'authenticated', 'authenticated', 'lookup@test.invalid', '{"display_name":"Lookup"}', now(), now());

set local role service_role;

-- Account + client: 10, then refused (case-insensitive subjects).
select is((select count(*)::int from generate_series(1, 10) n
           where consume_login_limit(array['acct:Alan@Example.com|client:a'], array[10]) is not null), 10,
  'ten attempts per account and client');
select is(consume_login_limit(array['acct:alan@example.com|client:a'], array[10]), null,
  'the eleventh is refused');
select isnt(consume_login_limit(array['acct:alan@example.com|client:b'], array[10]), null,
  'another client is not locked out by the first one');

-- Per client across accounts: spraying many usernames from one address hits its limit.
select is((select count(*)::int from generate_series(1, 25) n
           where consume_login_limit(array['acct:u' || n || '|client:sprayer', 'client:sprayer'],
                                     array[10, 20]) is not null), 20,
  'one client gets 20 attempts across all accounts');

-- A refused attempt spends nothing: a client that is already blocked can't use up the global
-- budget and lock out someone else (Josh's #85 re-review).
select isnt(consume_login_limit(array['client:blocked', 'global-test'], array[1, 3]), null,
  'the blocked client gets its one attempt');
select is((select count(*)::int from generate_series(1, 5) n
           where consume_login_limit(array['client:blocked', 'global-test'], array[1, 3]) is not null), 0,
  'then it is refused');
select is((select calls from rate_limit_counters where scope = 'password_login'
           and subject = md5('global-test')), 1,
  'refused attempts did not spend the global budget');
select isnt(consume_login_limit(array['client:new', 'global-test'], array[1, 3]), null,
  'a new client can still log in');
select is((select calls from rate_limit_counters where scope = 'password_login'
           and subject = md5('client:blocked')), 1,
  'refused attempts are not counted against the blocked client either');

-- A refund gives back exactly the attempt that was charged, and only once.
reset role;
create temp table charged (reservation text);
grant select, insert on charged to service_role;
set local role service_role;
insert into charged select consume_login_limit(array['acct:refund|client:a'], array[1]);
select isnt((select reservation from charged), null, 'the attempt is charged as a reservation');
select is(consume_login_limit(array['acct:refund|client:a'], array[1]), null,
  'the one attempt is spent');
select refund_login_limit('00000000-0000-4000-8000-000000000000');
select is(consume_login_limit(array['acct:refund|client:a'], array[1]), null,
  'refunding an unknown reservation gives nothing back');
select refund_login_limit((select reservation from charged));
select isnt(consume_login_limit(array['acct:refund|client:a'], array[1]), null,
  'a refunded attempt can be used again');
select refund_login_limit((select reservation from charged));
select is(consume_login_limit(array['acct:refund|client:a'], array[1]), null,
  'refunding the same reservation twice gives back only one attempt');

select is((select count(*)::int from rate_limit_counters
           where scope = 'password_login' and (subject like '%@%' or subject like '%client%')), 0,
  'no email or address is stored');

-- The sweep removes buckets older than a day, and keeps the current one.
insert into rate_limit_counters (scope, subject, bucket, calls)
values ('password_login', 'old', '2000-01-01T00:00', 3);
select ok(purge_login_limits() >= 1, 'old buckets are purged');

-- /usernames/available spends the same lookup quota as people search (30 a minute).
select lives_ok(
  $$select consume_username_lookup('91111111-1111-4111-8111-111111111111')
    from generate_series(1, 30)$$, 'thirty username checks a minute');
select throws_ok($$select consume_username_lookup('91111111-1111-4111-8111-111111111111')$$,
  'PT429', null, 'the thirty-first is refused');

select * from finish();
rollback;
