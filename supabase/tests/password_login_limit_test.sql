-- Per-account password login limit (0055_password_login_limit.sql, Alan).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(5);
set local role service_role;

select is((select count(*)::int from generate_series(1, 10) n
           where consume_login_limit('Alan@Example.com')), 10, 'ten attempts are allowed');
select is(consume_login_limit('alan@example.com'), false,
  'the eleventh is refused, case-insensitively');
select is(consume_login_limit('someone-else@example.com'), true, 'other accounts are unaffected');
select is((select count(*)::int from rate_limit_counters
           where scope = 'password_login' and subject like '%@%'), 0,
  'no email address is stored');

reset role;
set local role authenticated;
select throws_ok($$select consume_login_limit('x@example.com')$$, '42501', null,
  'clients cannot call it');

select * from finish();
rollback;
