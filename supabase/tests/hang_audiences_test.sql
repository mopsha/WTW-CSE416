begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(31);

insert into auth.users(id, email, raw_user_meta_data)
values
  ('54000000-0000-4000-8000-000000000001', 'hang54-host@example.test', '{"display_name":"Host 54"}'),
  ('54000000-0000-4000-8000-000000000002', 'hang54-overlap@example.test', '{"display_name":"Overlap 54"}'),
  ('54000000-0000-4000-8000-000000000003', 'hang54-group@example.test', '{"display_name":"Group 54"}'),
  ('54000000-0000-4000-8000-000000000004', 'hang54-uninvited@example.test', '{"display_name":"Other 54"}');

insert into public.groups(id, name, owner_id)
values
  ('54000000-0000-4000-8000-000000000011', 'Hang 54 A', '54000000-0000-4000-8000-000000000001'),
  ('54000000-0000-4000-8000-000000000012', 'Hang 54 B', '54000000-0000-4000-8000-000000000001'),
  ('54000000-0000-4000-8000-000000000013', 'Hang 54 unauthorized', '54000000-0000-4000-8000-000000000004');

insert into public.group_members(group_id, user_id, role)
values
  ('54000000-0000-4000-8000-000000000011', '54000000-0000-4000-8000-000000000001', 'owner'),
  ('54000000-0000-4000-8000-000000000012', '54000000-0000-4000-8000-000000000001', 'owner'),
  ('54000000-0000-4000-8000-000000000013', '54000000-0000-4000-8000-000000000004', 'owner'),
  ('54000000-0000-4000-8000-000000000011', '54000000-0000-4000-8000-000000000002', 'member'),
  ('54000000-0000-4000-8000-000000000012', '54000000-0000-4000-8000-000000000002', 'member'),
  ('54000000-0000-4000-8000-000000000012', '54000000-0000-4000-8000-000000000003', 'member')
on conflict do nothing;

insert into public.friendships(requester_id, addressee_id, status, accepted_at)
values ('54000000-0000-4000-8000-000000000001', '54000000-0000-4000-8000-000000000002', 'accepted', now());

create temporary table hang_request as
select jsonb_build_object(
  'activity', 'Stargazing at the trailhead', 'audience', 'selected',
  'groupIds', jsonb_build_array('54000000-0000-4000-8000-000000000011', '54000000-0000-4000-8000-000000000012'),
  'friendIds', jsonb_build_array('54000000-0000-4000-8000-000000000002'),
  'requestId', '54000000-0000-4000-8000-000000000021', 'startNow', true,
  'startsAt', now(), 'expiresAt', now() + interval '4 hours'
) as body;
grant select on hang_request to service_role;
set local role service_role;
create temporary table created_hang as
select public.hang_create('54000000-0000-4000-8000-000000000001', body) as post
from hang_request;
select is((select post->>'activity' from created_hang), 'Stargazing at the trailhead', 'custom activity is stored');
select is((select jsonb_array_length(post->'recipientIds') from created_hang), 2, 'overlapping groups and friend deduplicate');
select is((select count(*) from notifications where payload->>'hangId' = (select post->>'id' from created_hang)), 2::bigint, 'two inbox rows committed with the Hang');
select ok((select (post->>'startsAt')::timestamptz >= now()
  and (post->>'expiresAt')::timestamptz - (post->>'startsAt')::timestamptz = interval '4 hours'
  from created_hang), 'Right now uses server creation time and retains the RSVP cutoff');
create temporary table retried_hang as
select public.hang_create('54000000-0000-4000-8000-000000000001', body) as post
from hang_request;
select is((select post->>'id' from retried_hang), (select post->>'id' from created_hang), 'retry returns the original Hang');
select is((select jsonb_array_length(post->'recipientIds') from retried_hang), 0, 'retry has no new push recipients');
select is((select count(*) from notifications where payload->>'hangId' = (select post->>'id' from created_hang)), 2::bigint, 'retry does not duplicate inbox invitations');

select is((
  select public.hang_create('54000000-0000-4000-8000-000000000001',
    body || '{"activity":"  Stargazing at the trailhead ", "groupIds":["54000000-0000-4000-8000-000000000012","54000000-0000-4000-8000-000000000011","54000000-0000-4000-8000-000000000012"],"startsAt":"2020-01-01T00:00:00Z","expiresAt":"2020-01-01T04:00:00Z"}')->>'id'
  from hang_request
), (select post->>'id' from created_hang), 'set order, duplicate groups, surrounding whitespace and regenerated Right Now dates are equivalent');
select throws_ok($q$
  select public.hang_create('54000000-0000-4000-8000-000000000001', body || '{"activity":"Different activity"}')
  from hang_request
$q$, 'PT409', 'This send was already used for a different Hang.', 'activity changes conflict');
select throws_ok($q$
  select public.hang_create('54000000-0000-4000-8000-000000000001',
    body - 'groupIds' - 'friendIds' || '{"audience":"all_friends"}') from hang_request
$q$, 'PT409', null, 'audience changes conflict');

create temporary table scheduled_request as
  select body || jsonb_build_object('requestId','54000000-0000-4000-8000-000000000025',
    'startNow',false,'startsAt',now()+interval '1 hour','expiresAt',now()+interval '5 hours') as body
    from hang_request;
select ok((select public.hang_create('54000000-0000-4000-8000-000000000001', body) ? 'id'
  from scheduled_request), 'initial scheduled send succeeds');
select throws_ok($q$
  select public.hang_create('54000000-0000-4000-8000-000000000001',
    body || jsonb_build_object('startsAt',now()+interval '2 hours','expiresAt',now()+interval '6 hours'))
  from scheduled_request
$q$, 'PT409', null, 'changing the scheduled instant conflicts');

create temporary table all_friends_hang as
  select public.hang_create('54000000-0000-4000-8000-000000000001',
    '{"activity":"All friends snapshot","requestId":"54000000-0000-4000-8000-000000000026","audience":"all_friends","startNow":true}') as post;
create temporary table legacy_client_send as
  select public.hang_create('54000000-0000-4000-8000-000000000001', jsonb_build_object(
    'activity','Legacy client payload','audience','all_friends',
    'startsAt',now()+interval '1 hour','expiresAt',now()+interval '5 hours')) as post;
insert into public.friendships(requester_id, addressee_id, status, accepted_at)
values ('54000000-0000-4000-8000-000000000001', '54000000-0000-4000-8000-000000000004', 'accepted', now());
select is((select public.hang_get((post->>'id')::uuid, '54000000-0000-4000-8000-000000000004') from all_friends_hang),
  null, 'a new friendship does not gain access to a sent Hang');
select is((select public.hang_get((post->>'id')::uuid, '54000000-0000-4000-8000-000000000004') from legacy_client_send),
  null, 'new Hangs posted by older clients also use a snapshot');


select throws_ok($q$
  select public.hang_create('54000000-0000-4000-8000-000000000001',
    body || '{"requestId":"54000000-0000-4000-8000-000000000022","groupIds":["54000000-0000-4000-8000-000000000013"]}')
  from hang_request
$q$, 'PT403', null, 'a sender cannot use another group');
select throws_ok($q$
  select public.hang_create('54000000-0000-4000-8000-000000000001',
    body || '{"requestId":"54000000-0000-4000-8000-000000000023","groupIds":[],"friendIds":["54000000-0000-4000-8000-000000000003"]}')
  from hang_request
$q$, 'PT403', null, 'a sender cannot invite a nonfriend directly');
select throws_ok($q$
  select public.hang_create('54000000-0000-4000-8000-000000000001',
    body || '{"requestId":"54000000-0000-4000-8000-000000000024","startNow":false,"startsAt":"2020-01-01T00:00:00Z","expiresAt":"2020-01-01T04:00:00Z"}')
  from hang_request
$q$, 'PT400', null, 'a new scheduled Hang cannot start in the past');

select is((select public.hang_access((post->>'id')::uuid, '54000000-0000-4000-8000-000000000003')->>'selectedRecipient' from created_hang),
  'true', 'the API eligibility helper recognizes a selected group member');

select lives_ok($q$
  select public.hang_respond((select (post->>'id')::uuid from created_hang),
    '54000000-0000-4000-8000-000000000003', 'maybe')
$q$, 'an eligible guest can RSVP');
select is((select public.hang_get((post->>'id')::uuid, '54000000-0000-4000-8000-000000000001')->>'maybeCount' from created_hang),
  '1', 'the attendee summary counts eligible RSVPs');

delete from public.group_members where group_id = '54000000-0000-4000-8000-000000000012'
  and user_id = '54000000-0000-4000-8000-000000000003';
select is((select public.hang_get((post->>'id')::uuid, '54000000-0000-4000-8000-000000000003') from created_hang),
  null, 'removal from the selected group revokes visibility');
select throws_ok($q$
  select public.hang_respond((select (post->>'id')::uuid from created_hang),
    '54000000-0000-4000-8000-000000000003', 'down')
$q$, 'PT404', null, 'removed guests cannot RSVP');
insert into public.group_members(group_id, user_id, role, joined_at)
values ('54000000-0000-4000-8000-000000000012', '54000000-0000-4000-8000-000000000003',
  'member', now() + interval '1 second');
select is((select public.hang_get((post->>'id')::uuid, '54000000-0000-4000-8000-000000000003') from created_hang),
  null, 'rejoining does not restore a revoked send-time group grant');
insert into public.blocks(blocker_id, blocked_id)
values ('54000000-0000-4000-8000-000000000002', '54000000-0000-4000-8000-000000000001');
select is((select public.hang_get((post->>'id')::uuid, '54000000-0000-4000-8000-000000000002') from all_friends_hang),
  null, 'a block revokes original recipient access');
delete from public.blocks where blocker_id='54000000-0000-4000-8000-000000000002'
  and blocked_id='54000000-0000-4000-8000-000000000001';
delete from public.friendships where requester_id='54000000-0000-4000-8000-000000000001'
  and addressee_id='54000000-0000-4000-8000-000000000002';
select is((select public.hang_get((post->>'id')::uuid, '54000000-0000-4000-8000-000000000002') from all_friends_hang),
  null, 'unfriending revokes original recipient access');
insert into public.friendships(requester_id, addressee_id, status, accepted_at)
values ('54000000-0000-4000-8000-000000000001', '54000000-0000-4000-8000-000000000002', 'accepted', now()+interval '1 second');
select is((select public.hang_get((post->>'id')::uuid, '54000000-0000-4000-8000-000000000002') from all_friends_hang),
  null, 'a replacement friendship does not restore the grant');
select ok((select public.hang_get((post->>'id')::uuid, '54000000-0000-4000-8000-000000000001') is not null from all_friends_hang),
  'the author retains access');
grant select on created_hang to authenticated;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '54000000-0000-4000-8000-000000000004', true);
select is((select count(*) from public.hang_posts where id = (select (post->>'id')::uuid from created_hang)),
  0::bigint, 'RLS hides a selected Hang from an uninvited account');
select set_config('request.jwt.claim.sub', '54000000-0000-4000-8000-000000000002', true);
select is((select count(*) from public.hang_posts where id = (select (post->>'id')::uuid from created_hang)),
  1::bigint, 'RLS lets an authorized recipient read the Hang');
select ok(not has_function_privilege('authenticated', 'private.can_view_hang(uuid,uuid)', 'execute'),
  'clients cannot query arbitrary viewers through the policy helper');
select ok(not has_function_privilege('authenticated', 'public.hang_create(uuid,jsonb)', 'execute'),
  'direct authenticated writes cannot bypass the API');
reset role;

select * from finish();
rollback;
