begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(8);

insert into auth.users(id, email, raw_user_meta_data) values
  ('57000000-0000-4000-8000-000000000001', 'hang57-viewer@example.test', '{"display_name":"Viewer"}'),
  ('57000000-0000-4000-8000-000000000002', 'hang57-pending@example.test', '{"display_name":"Pending"}'),
  ('57000000-0000-4000-8000-000000000003', 'hang57-outsider@example.test', '{"display_name":"Outsider"}');

insert into public.friendships(requester_id, addressee_id, status, accepted_at)
values ('57000000-0000-4000-8000-000000000001', '57000000-0000-4000-8000-000000000002', 'accepted', now());

insert into public.hang_posts(id, author_id, activity, starts_at, expires_at, audience) values
  ('57000000-0000-4000-8000-000000000011', '57000000-0000-4000-8000-000000000001',
    'Coffee', now() + interval '1 hour', now() + interval '2 hours', 'all_friends'),
  ('57000000-0000-4000-8000-000000000012', '57000000-0000-4000-8000-000000000002',
    'Lunch', now() + interval '1 hour', now() + interval '2 hours', 'all_friends'),
  ('57000000-0000-4000-8000-000000000013', '57000000-0000-4000-8000-000000000003',
    'Walk', now() + interval '30 minutes', now() + interval '2 hours', 'all_friends');

set local role service_role;
select is(
  public.hang_list('57000000-0000-4000-8000-000000000001'),
  jsonb_build_array(
    public.hang_get('57000000-0000-4000-8000-000000000011', '57000000-0000-4000-8000-000000000001'),
    public.hang_get('57000000-0000-4000-8000-000000000012', '57000000-0000-4000-8000-000000000001')
  ),
  'Feed contains only accessible Hangs in starts_at and id order'
);
select is(
  public.hang_get('57000000-0000-4000-8000-000000000013', '57000000-0000-4000-8000-000000000001'),
  null::jsonb,
  'Inaccessible Hang has no detail projection'
);

reset role;
update public.profiles set avatar_deletion_pending = true
where id = '57000000-0000-4000-8000-000000000002';
set local role service_role;

select ok(
  private.can_view_hang('57000000-0000-4000-8000-000000000012', '57000000-0000-4000-8000-000000000001'),
  'Pending author Hang still passes the relationship check'
);
select is(
  public.hang_get('57000000-0000-4000-8000-000000000012', '57000000-0000-4000-8000-000000000001'),
  null::jsonb,
  'Pending author Hang has no detail projection'
);
select is(
  public.hang_list('57000000-0000-4000-8000-000000000001'),
  jsonb_build_array(
    public.hang_get('57000000-0000-4000-8000-000000000011', '57000000-0000-4000-8000-000000000001')
  ),
  'Feed omits the pending author Hang and keeps the normal Hang'
);
select is(
  public.hang_list('57000000-0000-4000-8000-000000000002'),
  '[]'::jsonb,
  'Feed has the usual empty array shape when all projections are unavailable'
);

reset role;
insert into public.hang_posts(id, author_id, activity, starts_at, expires_at, audience)
select ('57000000-0000-4000-8000-' || lpad((100 + n)::text, 12, '0'))::uuid,
  '57000000-0000-4000-8000-000000000001', 'Extra Hang ' || n,
  now() + interval '1 hour' + n * interval '1 minute',
  now() + interval '2 hours', 'all_friends'
from generate_series(1, 19) n;
set local role service_role;

with feed as materialized (
  select public.hang_list('57000000-0000-4000-8000-000000000001') as posts
)
select is(jsonb_array_length(posts), 20, 'Unavailable Hangs do not consume a feed slot')
from feed
union all
select is(posts->19->>'id', '57000000-0000-4000-8000-000000000119',
  'The valid Hang at candidate 21 fills the final slot in feed order')
from feed;

select * from finish();
rollback;
