-- Live progress (0005): finished_at follows "answered everything", and only the safe tables
-- are in the Realtime publication. Run: supabase test db (after supabase db reset).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(10);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '33333333-3333-4333-8333-333333333333',
  'authenticated', 'authenticated', 'live@test.invalid', '{"display_name":"Live"}', now(), now());
select private.seed_add_participant('33333333-3333-4333-8333-333333333333');

select is(
  (select finished_at from pick_participants
    where pick_id = 'de000000-0000-4000-8000-000000000001'
      and user_id = '33333333-3333-4333-8333-333333333333'),
  null, 'a new participant is not finished');

-- Answer 19 of the 20 demo candidates.
insert into preferences (pick_id, place_id, user_id, value)
select pick_id, place_id, '33333333-3333-4333-8333-333333333333', 1
from pick_candidates
where pick_id = 'de000000-0000-4000-8000-000000000001'
order by place_id
limit 19;

select is(
  (select finished_at from pick_participants
    where pick_id = 'de000000-0000-4000-8000-000000000001'
      and user_id = '33333333-3333-4333-8333-333333333333'),
  null, '19 of 20 answers is not finished');

insert into preferences (pick_id, place_id, user_id, value)
select pick_id, place_id, '33333333-3333-4333-8333-333333333333', 2
from pick_candidates
where pick_id = 'de000000-0000-4000-8000-000000000001'
order by place_id desc
limit 1;

select isnt(
  (select finished_at from pick_participants
    where pick_id = 'de000000-0000-4000-8000-000000000001'
      and user_id = '33333333-3333-4333-8333-333333333333'),
  null, 'the last answer sets finished_at');

-- Changing an answer (upsert = update) keeps them finished.
update preferences set value = 0
 where pick_id = 'de000000-0000-4000-8000-000000000001'
   and user_id = '33333333-3333-4333-8333-333333333333'
   and place_id = (select min(place_id) from pick_candidates where pick_id = 'de000000-0000-4000-8000-000000000001');
select isnt(
  (select finished_at from pick_participants
    where pick_id = 'de000000-0000-4000-8000-000000000001'
      and user_id = '33333333-3333-4333-8333-333333333333'),
  null, 'changing an answer keeps finished_at');

-- A host refresh wipes answers: no longer finished.
delete from preferences
 where pick_id = 'de000000-0000-4000-8000-000000000001'
   and user_id = '33333333-3333-4333-8333-333333333333';
select is(
  (select finished_at from pick_participants
    where pick_id = 'de000000-0000-4000-8000-000000000001'
      and user_id = '33333333-3333-4333-8333-333333333333'),
  null, 'clearing answers clears finished_at');

select ok(
  exists (select 1 from pg_publication_tables
          where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'picks')
  and exists (select 1 from pg_publication_tables
          where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pick_participants'),
  'picks and pick_participants are in the Realtime publication');
select ok(
  not exists (select 1 from pg_publication_tables
              where pubname = 'supabase_realtime' and schemaname = 'public'
                and tablename in ('preferences', 'ranking_results', 'final_votes')),
  'answers, scores and ballots are not in the Realtime publication');

-- 0005 publishes pick_participants, so UPDATEs need a replica identity (bug #18): without
-- one, the finished_at trigger (everyone's last swipe) fails with 55000.
select is(
  (select relreplident::text from pg_class where oid = 'public.pick_participants'::regclass),
  'i', 'pick_participants uses its unique index as replica identity');
select lives_ok(
  $$update pick_participants set finished_at = now()
    where pick_id = 'de000000-0000-4000-8000-000000000001'
      and user_id = '33333333-3333-4333-8333-333333333333'$$,
  'pick_participants can be updated while it is in the Realtime publication');

set local role authenticated;
set local request.jwt.claims to '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select throws_ok(
  $$select private.sync_participant_finished()$$,
  null, null, 'clients cannot call the trigger function');

select * from finish();
rollback;
