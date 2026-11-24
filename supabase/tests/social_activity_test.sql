begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(46);

insert into auth.users(id,email,raw_user_meta_data) values
 ('60000000-0000-4000-8000-000000000001','activity-owner@example.test','{"display_name":"Alex"}'),
 ('60000000-0000-4000-8000-000000000002','activity-guest@example.test','{"display_name":"Jordan"}'),
 ('60000000-0000-4000-8000-000000000003','activity-extra@example.test','{"display_name":"Maya"}');
update profiles set username = 'activity_alex', avatar_path = 'private/alex.jpg', avatar_revision = 1 where id = '60000000-0000-4000-8000-000000000001';
update profiles set username = 'activity_jordan', avatar_path = 'private/jordan.jpg', avatar_revision = 2 where id = '60000000-0000-4000-8000-000000000002';
create temporary table actors as select
 '60000000-0000-4000-8000-000000000001'::uuid owner,
 '60000000-0000-4000-8000-000000000002'::uuid guest,
 '60000000-0000-4000-8000-000000000003'::uuid extra;

select push_token_register(guest, 'ExpoPushToken[activity]', 'ios') from actors;
create temporary table first_request as
select friend_request_activity(owner, 'activity_jordan', guest) result from actors;
select ok((select result ? 'notificationId' from first_request), 'new incoming request has an exact push ID');
select is((select count(*)::int from first_request,
  notification_push_targets(array[(result->>'notificationId')::uuid])), 1, 'incoming request is push eligible');
select is((select (friend_request_activity(owner, 'activity_jordan', guest) ? 'notificationId') from actors),
 false, 'retry cannot request a second push');
select is((select count(*)::int from actors, activity_feed(guest, 51) where type = 'friend_request'),
 1, 'only one incoming activity row exists');
select is((select activity->>'actorName' from actors, activity_feed(guest, 51) where type = 'friend_request'),
 'Alex', 'name comes from the authenticated relationship actor');
select is((select activity->'avatarRef' from actors, activity_feed(guest, 51) where type = 'friend_request'),
 null::jsonb, 'pending friendship does not grant access to a photo');
select is((select count(*)::int from actors, first_request,
 activity_revalidate(extra, array[(result->>'notificationId')::uuid])),
 0, 'foreign activity IDs reveal no row or metadata');

select friend_accept(guest, owner) from actors;
select friend_accept(guest, owner) from actors;
select is((select count(*)::int from actors, activity_feed(guest, 51) where type = 'friend_request'),
 0, 'acceptance resolves the original request');
select is((select count(*)::int from actors, activity_feed(owner, 51) where type = 'friend_accepted'),
 1, 'the original requester receives a single acceptance');
select is((select activity->>'actorName' from actors, activity_feed(owner, 51) where type = 'friend_accepted'),
 'Jordan', 'acceptance projects the accepting friend');
select is((select activity->'avatarRef' from actors, activity_feed(owner, 51) where type = 'friend_accepted'),
  jsonb_build_object('userId','60000000-0000-4000-8000-000000000002','revision',2),
  'an accepted friend gets a photo reference without a storage path');
select push_token_register(owner, 'ExpoPushToken[activityOwner]', 'ios') from actors;
select is((select count(*)::int from actors, activity_feed(owner, 51) a,
 notification_push_targets(array[a.id]) where a.type = 'friend_accepted'), 0, 'acceptance stays in app');

select friend_remove(owner, guest) from actors;
select is((select count(*)::int from actors, activity_feed(owner, 51) where type = 'friend_accepted'),
 0, 'unfriending hides acceptance history');
select friend_request_activity(owner, 'activity_jordan', guest) from actors;
select friend_remove(guest, owner) from actors;
select is((select count(*)::int from actors, activity_feed(guest, 51) where type = 'friend_request'),
 0, 'declining hides the request');
create temporary table withdrawn_request as
select (friend_request_activity(owner, 'activity_jordan', guest)->>'notificationId')::uuid id from actors;
select friend_remove(owner, guest) from actors;
select is((select count(*)::int from withdrawn_request r, notification_push_targets(array[r.id])),
 0, 'withdrawal before the push target lookup prevents delivery');
select is((select count(*)::int from actors, activity_feed(guest, 51) where type = 'friend_request'),
 0, 'withdrawal hides the request');
create temporary table blocked_request as
select (friend_request_activity(owner, 'activity_jordan', guest)->>'notificationId')::uuid id from actors;
insert into blocks(blocker_id,blocked_id) select guest, owner from actors;
select is((select count(*)::int from actors, blocked_request r, activity_revalidate(guest, array[r.id])),
 0, 'blocking hides an existing pending request and its metadata');
select is((select count(*)::int from blocked_request r, notification_push_targets(array[r.id])),
 0, 'a blocked pending request cannot push');
delete from blocks using actors where blocker_id = guest and blocked_id = owner;

select friend_request_activity(owner, 'activity_jordan', guest) from actors;
select is((select friend_request_activity(guest, 'activity_alex', owner)->>'relationship' from actors),
 'friends', 'reciprocal username request still accepts canonically');
select is((select count(*)::int from actors, activity_feed(owner, 51) where type = 'friend_accepted'),
 1, 'reciprocal acceptance exposes only the current friendship instance');

insert into friendships(requester_id,addressee_id,status,accepted_at)
select owner, extra, 'accepted', now() from actors;
create temporary table hang as
select (hang_create(owner, jsonb_build_object('activity','Coffee','audience','all_friends',
 'requestId','60000000-0000-4000-8000-000000000012',
 'startsAt',now()+interval '1 hour','expiresAt',now()+interval '2 hours'))->>'id')::uuid id from actors;
select hang_respond(h.id, owner, 'down') from actors, hang h;
select is((select count(*)::int from actors, activity_feed(owner, 51) where type = 'hang_rsvp'),
 0, 'an organizer never receives their own response');
select hang_respond(h.id, guest, 'down') from actors, hang h;
select hang_respond(h.id, extra, 'down') from actors, hang h;
create temporary table first_reply as
select a.id, a.created_at, a.activity_at from actors, activity_feed(owner, 51) a where type = 'hang_rsvp';
select is((select count(*)::int from first_reply), 1, 'responses use one grouped activity row');
select is((select activity->>'replyCount' from actors, activity_feed(owner, 51) where type = 'hang_rsvp'),
 '2', 'group count excludes the organizer');
select is((select count(*)::int from first_reply, notification_push_targets(array[first_reply.id])),
 0, 'Hang responses never push');
select notification_mark_read(first_reply.id, owner) from actors, first_reply;
select hang_respond(h.id, extra, 'down') from actors, hang h;
select ok((select a.read_at is not null and a.activity_at = r.activity_at
 from actors, first_reply r, activity_feed(owner, 51) a where a.id = r.id),
 'an unchanged RSVP preserves read status and activity order');
select hang_respond(h.id, extra, 'maybe') from actors, hang h;
select ok((select read_at is null and activity->>'replyCount' = '1' and activity->>'otherReplyCount' = '1'
 from actors, activity_feed(owner, 51) where type = 'hang_rsvp'),
 'a meaningful RSVP change updates the two counts on the same row');
select ok((select a.id = r.id and a.created_at = r.created_at and a.activity_at > r.activity_at from actors, first_reply r, activity_feed(owner, 51) a
 where a.type = 'hang_rsvp'), 'group updates keep identity and creation time while advancing activity time');

select hang_respond(h.id, guest, 'cant') from actors, hang h;
select hang_respond(h.id, extra, 'cant') from actors, hang h;
select ok((select activity->>'replyStatus' = 'cant' and activity->>'replyCount' = '2'
    and not (activity ? 'actorName') and not (activity ? 'avatarRef')
    from actors, activity_feed(owner, 51) where type = 'hang_rsvp'),
  'negative responses can appear only as anonymous grouped activity');
select hang_respond(h.id, guest, 'down') from actors, hang h;
select hang_respond(h.id, extra, 'maybe') from actors, hang h;

create temporary table activity_boundary as
select a.id, coalesce(a.activity_at, a.created_at) sort_at from actors, activity_feed(owner, 1) a;
select is((select count(*)::int from actors, activity_boundary b,
  activity_feed(owner, 51, b.sort_at, b.id)),
  (select count(*)::int - 1 from actors, activity_feed(owner, 51)),
  'the enriched page retains the exact activity timestamp and ID boundary');
select ok((select a.activity->>'hangName' = 'Coffee' from actors, first_reply r,
 activity_revalidate(owner, array[r.id]) a),
 'revalidation also projects the current authorized metadata');

create temporary table activity_group as
select (group_create(owner, 'Friday Crew')->>'id')::uuid id from actors;
select group_invite_members(owner, g.id, array[guest]) from actors, activity_group g;
create temporary table activity_invite as
select i.id from group_invitations i, activity_group g where i.group_id = g.id;
select notify_insert(array[guest], 'group_invite', null, jsonb_build_object('inviteId', i.id))
from actors, activity_invite i;
select ok((select activity->>'actorName' = 'Alex' and activity->>'groupName' = 'Friday Crew'
  from actors, activity_feed(guest, 51) where type = 'group_invite'),
  'group context is visible through an authorized pending invitation');
select group_invitation_resolve(guest, i.id, 'accepted') from actors, activity_invite i;
create temporary table activity_message as
select group_chat('send', owner, g.id, '{"body":"Sensitive preview","clientId":"activity-message"}') result
from actors, activity_group g;
select notify_insert(array[guest], 'group_message', null,
  jsonb_build_object('groupId', g.id, 'messageId', m.result->'message'->>'id'))
from actors, activity_group g, activity_message m;
select ok((select activity->>'actorName' = 'Alex' and activity->>'groupName' = 'Friday Crew'
  and activity::text not like '%Sensitive preview%'
  from actors, activity_feed(guest, 51) where type = 'group_message'),
  'chat projection includes the sender and group without message content');
select group_remove_member(owner, g.id, guest) from actors, activity_group g;
select is((select count(*)::int from actors, activity_feed(guest, 51) where type = 'group_message'),
 0, 'membership revocation removes group names and sender metadata');

-- Put 51 readable historical rows ahead of the group without changing its creation time.
select hang_respond(h.id, extra, 'down') from actors, hang h;
select notification_mark_read(first_reply.id, owner) from actors, first_reply;
create temporary table before_revocation as
select activity_snapshot(owner, array[r.id], 51, null, null, null) result from actors, first_reply r;
select ok((select result->'notifications'->0->'activity'->>'actorName' = 'Jordan'
  and result->'notifications'->0->'activity'->>'replyCount' = '2'
  and result->'notifications'->0->'activity' ? 'avatarRef'
  and result->'notifications'->0->'read_at' <> 'null'::jsonb from before_revocation),
  'the older view had the now-revoked actor, avatar and read state');
create temporary table activity_filler as select gen_random_uuid() id from generate_series(1,51);
insert into picks(id,host_id,state,category,center_lat,center_lng,radius_m)
select f.id,owner,'canceled','food',40,-73,1000 from activity_filler f,actors;
insert into pick_participants(pick_id,user_id) select f.id,owner from activity_filler f,actors;
insert into notifications(user_id,type,pick_id,created_at,read_at)
select owner,'pick_canceled',f.id,clock_timestamp(),now() from activity_filler f,actors;
create temporary table deep_page as
select activity_snapshot(owner, array[r.id], 51, null, null, null) result from actors, first_reply r;
select ok((select not exists (select from jsonb_array_elements(result->'page') row
  where row->>'type' = 'hang_rsvp') from deep_page),
  '51 newer rows hide the read Hang group from the head page');

insert into blocks(blocker_id,blocked_id) select owner, guest from actors;
select hang_respond(h.id, extra, 'maybe') from actors, hang h;
create temporary table fresh_page as
select activity_snapshot(owner, array[r.id], 51, null, null, null) result from actors, first_reply r;
select ok((select result->'page'->0 = result->'notifications'->0
  and result->'page'->0->'activity'->>'actorName' = 'Maya'
  and result->'page'->0->'activity'->>'replyCount' = '1'
  and not (result->'page'->0->'activity' ? 'avatarRef')
  and result->'page'->0->'read_at' = 'null'::jsonb from fresh_page),
  'a new RSVP moves the group to the top and both projections use the same authorized unread row');
select is((select count(*)::int from fresh_page, jsonb_array_elements(result->'page') row
  where row->'read_at' = 'null'::jsonb), 1, 'the resurfaced group contributes one unread item');
select is((select count(*)::int from notifications n, actors, hang h where n.user_id = owner
  and n.type = 'hang_rsvp' and n.payload->>'hangId' = h.id::text), 1, 'a resurfaced Hang still has one stored group');
select ok((select (fresh->>'reset')::boolean and fresh->'page'->0->>'id' = r.id::text
  and fresh->'notifications' = '[]'::jsonb
  from actors, deep_page p, first_reply r, lateral activity_snapshot(owner, array[r.id], 51,
    (p.result->'page'->49->>'created_at')::timestamptz,
    (p.result->'page'->49->>'id')::uuid, (p.result->>'orderVersion')::bigint) fresh),
  'a cursor issued before the reorder restarts at the head, even when its boundary is still valid');
update profiles set avatar_deletion_pending = true where id = (select extra from actors);
select is((select count(*)::int from actors, activity_feed(owner, 51) where type in ('hang_rsvp','friend_accepted')),
 0, 'revoked or deletion-pending actors leave no social activity');

select is((select count(*)::int from actors, activity_feed(guest, 51) where type = 'friend_request'),
 0, 'blocked accounts have no incoming request metadata');
select ok(not has_function_privilege('authenticated', 'public.activity_feed(uuid,integer,timestamptz,uuid)', 'EXECUTE'),
  'authenticated clients cannot choose another recipient through the Activity RPC');

insert into auth.users(id,email,raw_user_meta_data) values
 ('60000000-0000-4000-8000-000000000004','activity-deleting@example.test','{"display_name":"Deleted requester"}');
create temporary table deletion_request as
select (friend_request_activity('60000000-0000-4000-8000-000000000004', 'activity_jordan', guest)
  ->>'notificationId')::uuid id from actors;
select is((select count(*)::int from actors, deletion_request r, activity_revalidate(guest, array[r.id])),
 1, 'the deleting account first has an authorized incoming request');
delete from auth.users where id = '60000000-0000-4000-8000-000000000004';
select is((select count(*)::int from actors, deletion_request r, activity_revalidate(guest, array[r.id])),
 0, 'account deletion revokes a previously loaded incoming request');
select is((select count(*)::int from deletion_request r, notification_push_targets(array[r.id])),
 0, 'account deletion also invalidates the pending push');

select ok(not has_function_privilege('authenticated',
  'public.activity_snapshot(uuid,uuid[],integer,timestamptz,uuid,bigint)', 'EXECUTE'),
  'only the service role can request a combined owner snapshot');

select * from finish();
rollback;
