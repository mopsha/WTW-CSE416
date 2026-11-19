-- Password login limits (0057_password_login_limit.sql, Alan).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(10);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '91111111-1111-4111-8111-111111111111',
  'authenticated', 'authenticated', 'lookup@test.invalid', '{"display_name":"Lookup"}', now(), now());

set local role service_role;

-- Account + client: 10, then refused (case-insensitive subjects).
select is((select count(*)::int from generate_series(1, 10) n
           where consume_login_limit(array['acct:Alan@Example.com|client:a'], array[10])), 10,
  'ten attempts per account and client');
select is(consume_login_limit(array['acct:alan@example.com|client:a'], array[10]), false,
  'the eleventh is refused');
select is(consume_login_limit(array['acct:alan@example.com|client:b'], array[10]), true,
  'another client is not locked out by the first one');

-- Per client across accounts: spraying many usernames from one address hits its limit.
select is((select count(*)::int from generate_series(1, 25) n
           where consume_login_limit(array['acct:u' || n || '|client:sprayer', 'client:sprayer'],
                                     array[10, 20])), 20,
  'one client gets 20 attempts across all accounts');

-- A refund gives an attempt back.
select refund_login_limit(array['acct:alan@example.com|client:a']);
select is(consume_login_limit(array['acct:alan@example.com|client:a'], array[10]), true,
  'a refunded attempt can be used again');

select is((select count(*)::int from rate_limit_counters
           where scope = 'password_login' and (subject like '%@%' or subject like '%client%')), 0,
  'no email or address is stored');

-- The sweep removes buckets older than a day, and keeps the current one.
insert into rate_limit_counters (scope, subject, bucket, calls)
values ('password_login', 'old', '2000-01-01T00:00', 3);
select ok(purge_login_limits() >= 1, 'old buckets are purged');
select ok(exists (select 1 from rate_limit_counters where scope = 'password_login'),
  'current buckets stay');

-- /usernames/available spends the same lookup quota as people search (30 a minute).
select lives_ok(
  $$select consume_username_lookup('91111111-1111-4111-8111-111111111111')
    from generate_series(1, 30)$$, 'thirty username checks a minute');
select throws_ok($$select consume_username_lookup('91111111-1111-4111-8111-111111111111')$$,
  'PT429', null, 'the thirty-first is refused');

select * from finish();
rollback;
