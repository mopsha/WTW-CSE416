begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(15);

insert into auth.users(id, email) values
  ('59010000-0000-4000-8000-000000000001', 'schedule-review-host@example.test'),
  ('59010000-0000-4000-8000-000000000002', 'schedule-review-guest@example.test');
create temporary table subject as select
  '59010000-0000-4000-8000-000000000001'::uuid host,
  '59010000-0000-4000-8000-000000000002'::uuid guest,
  (pick_create('59010000-0000-4000-8000-000000000001', 'food', 40, -73, 1000, 5, null, 100)->>'id')::uuid as pick;
insert into pick_participants(pick_id, user_id) select pick, guest from subject;
insert into places(id,name,category,lat,lng) values ('schedule-review', 'Cafe', 'food', 40, -73);
insert into pick_candidates(pick_id,place_id,snapshot) select pick,'schedule-review','{"name":"Cafe"}' from subject;
update private.feature_launches set launched_at = now() - interval '1 day' where feature = 'did_you_go';
update picks set state = 'completed', plan_at = now() + interval '45 minutes',
  decided_at = now(), winner_place_id = 'schedule-review', decided_by = 'clear_winner'
from subject where id = pick;
select push_token_register(guest, 'ExpoPushToken[scheduleReview]', 'ios') from subject;

-- Same storage and payload as a notice recorded by the Edge Function before 0059.
select notify_insert(array[guest], 'plan_time_set', pick, '{}') from subject;
select notify_insert(array[guest], 'winner_decided', pick, '{}') from subject;
update notifications set created_at = now() - interval '2 days' where type = 'plan_time_set';
update notifications set created_at = now() - interval '3 days' where type = 'winner_decided';
create temporary table old_boundary as
select n.id, n.created_at from subject, notification_feed(guest, 1) n;
select is((select type from notifications where id = (select id from old_boundary)), 'plan_time_set',
  'legacy time-set is visible until its schedule changes');

create temporary table old_targets as
select t.* from subject, pick_plan_targets_with_revision(now()) t where t.pick_id = pick and kind = 'plan_reminder';
select is((select count(*)::int from old_targets), 1, 'the old schedule was selected by the sweep');

select pick_set_plan_time(pick::text, host, now() + interval '50 minutes') from subject;
select is((select count(*)::int from subject, old_targets t, notification_record(
  array[guest], t.kind, t.pick_id, jsonb_build_object('scheduleRevision', t.schedule_revision))),
  0, 'a sweep selected before the edit cannot record after the edit');
select is((select count(*)::int from subject, notification_feed(guest, 51) where type = 'plan_time_set'),
  0, 'a superseded legacy notice is hidden even when a replacement notice was never recorded');
select is((select n.type from subject, old_boundary b, notification_feed(guest, 1, b.created_at, b.id) n),
  'winner_decided', 'cursor still reaches older authorized history after the boundary was hidden');
select is((select count(*)::int from subject, old_boundary b, notification_revalidate(guest, array[b.id])),
  0, 'revalidation removes the superseded row from loaded pages');
select is((select count(*)::int from subject, notification_revalidate(host,
  array(select id from notifications where type = 'winner_decided'))),
  0, 'a foreign notification ID returns no metadata when revalidating');

-- Simulate the cooldown having elapsed. The selected revision can fill the slot.
update picks set plan_time_changed_at = now() - interval '31 minutes' from subject where id = pick;
create temporary table current_targets as
select t.* from subject, pick_plan_targets_with_revision(now()) t where t.pick_id = pick and kind = 'plan_reminder';
create temporary table current_notice as
select notification_record(array[guest], t.kind, t.pick_id, jsonb_build_object('scheduleRevision', t.schedule_revision)) id
from subject, current_targets t;
select is((select count(*)::int from current_notice), 1, 'new revision retains the reminder slot after cooldown');
select is((select count(*)::int from notification_push_targets(array(select id from current_notice))),
  1, 'the valid reminder can push');
select is((select count(*)::int from subject, current_targets t, notification_record(
  array[guest], t.kind, t.pick_id, jsonb_build_object('scheduleRevision', t.schedule_revision))),
  0, 'a second sweep of the current revision returns no new push ID');

-- Opposite ordering. The recorder wins first, then the change deletes the committed row.
select pick_set_plan_time(pick::text, host, now() + interval '55 minutes') from subject;
select is((select count(*)::int from notifications where id in (select id from current_notice)),
  0, 'a later reschedule clears a reminder recorded first');

-- Attendance is also revision bound, even when both the old and new dates qualify.
update picks set plan_at = now() - interval '5 hours' from subject where id = pick;
create temporary table old_attendance as
select t.* from subject, pick_plan_targets_with_revision(now()) t where t.pick_id = pick and kind = 'did_you_go';
update picks set plan_at = now() - interval '4 hours' from subject where id = pick;
select is((select count(*)::int from subject, old_attendance t, notification_record(
  array[guest], t.kind, t.pick_id, jsonb_build_object('scheduleRevision', t.schedule_revision))),
  0, 'attendance from a superseded revision never consumes the slot');
select is((select count(*)::int from subject, pick_plan_targets_with_revision(now()) t, notification_record(
  array[guest], t.kind, t.pick_id, jsonb_build_object('scheduleRevision', t.schedule_revision))
  where t.pick_id = pick and kind = 'did_you_go'),
  1, 'current eligible attendance can record once');
select pick_set_plan_time(pick::text, host, now() + interval '45 minutes') from subject;
select is((select count(*)::int from notifications where type = 'did_you_go'), 0,
  'rescheduling after attendance recording clears the previous row');
select is((select count(*)::int from subject, notification_record(array[guest], 'did_you_go', pick,
  jsonb_build_object('scheduleRevision', (select schedule_revision from picks where id = pick)))),
  0, 'current revision alone is insufficient if attendance is not yet due');

select * from finish();
rollback;
