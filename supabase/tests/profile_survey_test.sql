-- Survey answers (0011) stay private: only the API's service role reads them.
-- Run: supabase test db (after supabase db reset).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(6);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '33333333-3333-4333-8333-333333333333',
  'authenticated', 'authenticated', 'survey@test.invalid', '{"display_name":"Sam"}', now(), now());

select is((select preferences_updated_at from profiles where id = '33333333-3333-4333-8333-333333333333'),
  null, 'a new account has not finished onboarding');
select is((select discover_preferences from profiles where id = '33333333-3333-4333-8333-333333333333'),
  '{}'::jsonb, 'a new account starts with no survey answers');
select throws_ok(
  $$update profiles set discover_preferences = '[]'::jsonb
    where id = '33333333-3333-4333-8333-333333333333'$$,
  '23514', null, 'survey answers must be a JSON object');

set local role authenticated;
set local request.jwt.claims to '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';

select is((select display_name from profiles where id = '33333333-3333-4333-8333-333333333333'),
  'Sam', 'I can still read my display name');
select throws_ok($$select discover_preferences from profiles$$, '42501', null,
  'clients cannot read survey answers, even their own');
select throws_ok($$select preferences_updated_at from profiles$$, '42501', null,
  'clients cannot read the onboarding timestamp');

select * from finish();
rollback;
