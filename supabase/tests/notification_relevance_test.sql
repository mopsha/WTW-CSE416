begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(39);

insert into auth.users(id, email, raw_user_meta_data) values
  ('59000000-0000-4000-8000-000000000001', 'phase1-host@example.test', '{"display_name":"Host"}'),
  ('59000000-0000-4000-8000-000000000002', 'phase1-guest@example.test', '{"display_name":"Guest"}');

insert into public.friendships(requester_id, addressee_id, status, accepted_at)
values ('59000000-0000-4000-8000-000000000001', '59000000-0000-4000-8000-000000000002', 'accepted', now());

create temporary table fixture as select
  '59000000-0000-4000-8000-000000000001'::uuid host,
  '59000000-0000-4000-8000-000000000002'::uuid guest,
  '59000000-0000-4000-8000-000000000010'::uuid pick,
  '59000000-0000-4000-8000-000000000011'::uuid grp,
  '59000000-0000-4000-8000-000000000012'::uuid invite;
grant select on fixture to service_role;
create temporary table recorded (kind text primary key, id uuid not null);
grant select, insert on recorded to service_role;

insert into public.groups(id, name, owner_id) select grp, 'Phase 1', host from fixture;
insert into public.group_members(group_id, user_id, role)
select grp, host, 'owner' from fixture on conflict do nothing;
insert into public.group_invitations(id, group_id, inviter_id, invitee_id)
select invite, grp, host, guest from fixture;

insert into public.picks(id, host_id, category, center_lat, center_lng, radius_m)
select pick, host, 'food', 40, -73, 1000 from fixture;
insert into public.pick_participants(pick_id, user_id)
select pick, host from fixture union all select pick, guest from fixture;
insert into public.places(id, name, category, lat, lng)
values ('phase1-choice', 'Cafe', 'food', 40, -73);
insert into public.pick_candidates(pick_id, place_id, snapshot)
select pick, 'phase1-choice', '{"name":"Cafe"}' from fixture;

set local role service_role;
select push_token_register(guest, 'ExpoPushToken[phase1a]', 'ios') from fixture;
select push_token_register(guest, 'ExpoPushToken[phase1b]', 'android') from fixture;

insert into recorded
select 'added_to_pick', notification_record(array[guest, guest], 'added_to_pick', pick, '{}')
from fixture;
select is((select count(*)::int from recorded), 1, 'one inbox row for duplicate recipient IDs');
select is((select count(*)::int from fixture, notification_record(array[guest], 'added_to_pick', pick, '{}')),
  0, 'replaying a Pick event returns no ID for another push');
select is((select count(*)::int from fixture, notification_feed(guest, 51)), 1,
  'draft Pick addition is visible in the inbox');
select is((select count(*)::int from notification_push_targets(array(select id from recorded))),
  0, 'draft Pick addition has no push targets');

insert into recorded
select 'group_invite', notification_record(array[guest], 'group_invite', null, jsonb_build_object('inviteId', invite))
from fixture;
select is((select count(*)::int from notification_push_targets(array(select id from recorded where kind = 'group_invite'))),
  2, 'both devices can receive the same invitation notification');
select is((select count(distinct notification_id)::int
           from notification_push_targets(array(select id from recorded where kind = 'group_invite'))),
  1, 'each device gets the same inbox row ID');
select group_invitation_resolve(guest, invite, 'accepted') from fixture;
select is((select count(*)::int from fixture, notification_feed(guest, 51) where type = 'group_invite'),
  0, 'accepted invitation is removed from the actionable feed');
select is((select count(*)::int from notification_push_targets(array(select id from recorded where kind = 'group_invite'))),
  0, 'accepted invitation never pushes');

create temporary table new_hang as
select hang_create(host, jsonb_build_object(
  'activity', 'Coffee', 'audience', 'all_friends',
  'requestId', '59000000-0000-4000-8000-000000000013',
  'startsAt', now() + interval '1 hour', 'expiresAt', now() + interval '2 hours'
)) as post from fixture;
select is((select count(*)::int from new_hang, fixture,
  notification_push_targets('{}', post->>'id', array[guest])),
  2, 'Hang fanout targets both devices without reinserting the invitation');
select hang_respond((post->>'id')::uuid, guest, 'maybe') from new_hang, fixture;
select is((select count(*)::int from new_hang, fixture,
  notification_push_targets('{}', post->>'id', array[guest])),
  0, 'an RSVP removes the Hang push targets');
select is((select count(*)::int from fixture, notification_feed(guest, 51) where type = 'hang_invite'),
  0, 'a resolved Hang invite is hidden from the actionable feed');

select hang_respond((post->>'id')::uuid, guest, 'down') from new_hang, fixture;
select hang_respond((post->>'id')::uuid, host, 'down') from new_hang, fixture;
create temporary table hang_pick as
select (hang_create_pick((post->>'id')::uuid, host,
  '{"category":"food","center":{"lat":40,"lng":-73},"radiusM":1000,"poolSize":5,"closeThreshold":100}'
  )->>'pickId')::uuid id from new_hang, fixture;
select is((select joined_pick_state::text from hang_pick, fixture, public.pick_participants pp
           where pp.pick_id = hang_pick.id and pp.user_id = guest), 'draft',
  'Hang-to-Pick captures the draft stage for the added guest');

create temporary table group_pick as
select (pick_create(host, 'food', 40, -73, 1000, 5, null, 100)->>'id')::uuid id from fixture;
select pick_add_group(group_pick.id, host, grp) from group_pick, fixture;
select is((select joined_pick_state::text from group_pick, fixture, public.pick_participants pp
           where pp.pick_id = group_pick.id and pp.user_id = guest), 'draft',
  'group Pick creation captures the draft stage for the added guest');
select pick_cancel(group_pick.id::text, host, null) from group_pick, fixture;
create temporary table repeated_pick as
select (pick_again(group_pick.id::text, host)->>'id')::uuid id from group_pick, fixture;
select is((select joined_pick_state::text from repeated_pick, fixture, public.pick_participants pp
           where pp.pick_id = repeated_pick.id and pp.user_id = guest), 'draft',
  'Pick Again captures the draft stage for the added guest');

create temporary table sent_chat as
select group_chat('send', host, grp, '{"body":"Hi","clientId":"phase1-chat"}') as result from fixture;
insert into recorded
select 'group_message', notification_record(array[guest], 'group_message', null,
  jsonb_build_object('groupId', grp, 'messageId', result->'message'->>'id'))
from sent_chat, fixture;
select is((select count(*)::int from notification_push_targets(array(select id from recorded where kind = 'group_message'))),
  2, 'a current message returns the IDs for the fresh message push');

reset role;
update public.picks set state = 'swiping', group_id = grp, deadline_at = now() + interval '25 minutes'
from fixture where id = pick;
set local role service_role;
insert into recorded
select event.kind, notification_record(array[guest], event.kind, pick, '{}')
from fixture cross join (values ('pick_started'), ('reminder')) event(kind);
select is((select count(*)::int from notification_push_targets(array(select id from recorded where kind = 'added_to_pick'))),
  0, 'starting does not turn a draft addition into a push');
select is((select count(*)::int from notification_push_targets(array(select id from recorded where kind = 'reminder'))),
  2, 'unfinished swipe reminder is eligible');
reset role;
update public.pick_participants set finished_at = now() from fixture where pick_id = pick and user_id = guest;
set local role service_role;
select is((select count(*)::int from fixture, notification_feed(guest, 51) where type in ('pick_started','reminder')),
  0, 'finished swiping clears both actionable notices');
select is((select count(*)::int from notification_push_targets(array(select id from recorded where kind = 'reminder'))),
  0, 'a finished participant cannot receive the swipe reminder');

reset role;
update public.picks set state = 'final_vote', vote_deadline_at = now() + interval '20 minutes'
from fixture where id = pick;
set local role service_role;
insert into recorded
select 'vote_needed', notification_record(array[guest], 'vote_needed', pick, '{}') from fixture;
select is((select count(*)::int from notification_push_targets(array(select id from recorded where kind = 'vote_needed'))),
  2, 'a current uncast vote can push to both devices');

reset role;
insert into public.final_votes(pick_id, user_id, place_id) select pick, guest, 'phase1-choice' from fixture;
set local role service_role;
select is((select count(*)::int from fixture, notification_feed(guest, 51) where type = 'vote_needed'),
  0, 'a ballot clears the vote notification');
select is((select count(*)::int from notification_push_targets(array(select id from recorded where kind = 'vote_needed'))),
  0, 'a ballot suppresses the vote push');

reset role;
delete from public.final_votes using fixture where pick_id = pick and user_id = guest;
update public.picks set vote_deadline_at = now() - interval '1 minute' from fixture where id = pick;
set local role service_role;
select is((select count(*)::int from notification_push_targets(array(select id from recorded where kind = 'vote_needed'))),
  0, 'an expired vote never pushes');

reset role;
update public.picks set state = 'completed', plan_at = now() + interval '20 minutes', plan_time_changes = 1
from fixture where id = pick;
set local role service_role;
select is((select count(*)::int from fixture, pick_plan_targets(now()) where pick_id = pick and kind = 'plan_reminder'),
  0, 'the sweep does not consume a starting-soon slot during the cooldown');
insert into recorded
select 'plan_reminder', notification_record(array[guest], 'plan_reminder', pick,
  jsonb_build_object('scheduleRevision', schedule_revision))
from fixture join public.picks on id = pick;
select is((select count(*)::int from notification_push_targets(array(select id from recorded where kind = 'plan_reminder'))),
  0, 'a recent time edit suppresses starting soon even before its notice is recorded');
select is((select count(*)::int from fixture, notification_record(array[guest], 'plan_time_set', pick,
  jsonb_build_object('planAt', now() + interval '10 minutes'))),
  0, 'a superseded time edit does not record a misleading notice');
insert into recorded
select 'winner_decided', notification_record(array[guest], 'winner_decided', pick, '{}') from fixture;
insert into recorded
select 'plan_time_set', notification_record(array[guest], 'plan_time_set', pick,
  jsonb_build_object('planAt', now() + interval '20 minutes')) from fixture;
select is((select count(*)::int from fixture, notification_record(array[guest], 'plan_time_set', pick, '{}')),
  0, 'a schedule revision only records once per guest');
select is((select count(*)::int from notification_push_targets(array(select id from recorded where kind = 'plan_time_set'))),
  2, 'the newly scheduled plan can push');
select is((select count(*)::int from notification_push_targets(array(select id from recorded where kind = 'plan_reminder'))),
  0, 'a starting-soon push is suppressed after a recent schedule notice');

reset role;
update public.picks set state = 'canceled', cancel_reason = 'Rained out' from fixture where id = pick;
set local role service_role;
insert into recorded
select 'pick_canceled', notification_record(array[guest], 'pick_canceled', pick, '{"reason":"Rained out"}')
from fixture;
select is((select array_agg(type) from fixture, notification_feed(guest, 51) where pick_id = pick), array['pick_canceled']::text[],
  'cancellation clears the action prompts and remains visible');
select is((select count(*)::int from notification_push_targets(array(select id from recorded where kind = 'pick_canceled'))),
  2, 'current cancellation can push');
select notification_mark_read((select id from recorded where kind = 'pick_canceled'), guest) from fixture;
select is((select count(*)::int from notification_push_targets(array(select id from recorded where kind = 'pick_canceled'))),
  0, 'marking the exact inbox row read prevents sending it again');

reset role;
delete from public.group_members using fixture where group_id = grp and user_id = guest;
set local role service_role;
select is((select count(*)::int from fixture, notification_feed(guest, 51)), 0,
  'group departure hides cancellation and private reason at the API');
select is((select count(*)::int from notification_push_targets(array(select id from recorded where kind = 'group_message'))),
  0, 'group departure suppresses a message push recorded earlier');
select is((select count(*)::int from fixture, notification_revalidate(guest,
              array(select id from recorded where kind = 'pick_canceled'))),
  0, 'revalidating an already loaded cancellation withholds its old reason after departure');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"59000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.notifications), 0, 'direct RLS read also hides revoked rows');
reset role;

insert into public.group_members(group_id, user_id) select grp, guest from fixture;
insert into public.blocks(blocker_id, blocked_id) select guest, host from fixture;
set local role service_role;
select is((select count(*)::int from fixture, notification_feed(guest, 51)), 0,
  'blocking the host hides the old notification even after group membership is restored');
select is((select count(*)::int from notification_push_targets(array(select id from recorded where kind = 'group_message'))),
  0, 'blocking suppresses a previously recorded group message push');
reset role;
delete from public.blocks using fixture where blocker_id = guest and blocked_id = host;
update public.profiles set avatar_deletion_pending = true from fixture where id = host;
set local role service_role;
select is((select count(*)::int from fixture, notification_feed(guest, 51)), 0,
  'pending account deletion also hides private Pick notifications');

select * from finish();
rollback;
