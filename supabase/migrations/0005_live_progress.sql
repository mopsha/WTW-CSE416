-- Live progress for the waiting room (Mike). Week 3.
-- Contract: src/hooks/usePickLive.ts, supabase/functions/_shared/api/progress.ts.
--
-- 1. pick_participants.finished_at is kept current by a trigger on preferences: set when a
--    participant has answered every candidate, cleared again if their answers are wiped (a
--    host refresh). It only changes when "done" flips, so Realtime sends one event per person
--    per change, not one per swipe.
-- 2. picks and pick_participants join the supabase_realtime publication, so the app hears
--    state changes and "X finished" without polling. Realtime applies the same SELECT RLS
--    as the app's reads. preferences, final_votes and ranking_results stay OUT of the
--    publication: individual answers and scores must never go over the socket.
--
-- Depends only on 0001. It does not touch tables from other in-flight migrations.

create function private.sync_participant_finished()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pick uuid;
  v_user uuid;
  v_candidates integer;
  v_answered integer;
  v_done boolean;
begin
  if tg_op = 'DELETE' then
    v_pick := old.pick_id;
    v_user := old.user_id;
  else
    v_pick := new.pick_id;
    v_user := new.user_id;
  end if;

  select count(*) into v_candidates from public.pick_candidates where pick_id = v_pick;
  select count(*) into v_answered
    from public.preferences where pick_id = v_pick and user_id = v_user;
  v_done := v_candidates > 0 and v_answered >= v_candidates;

  update public.pick_participants
     set finished_at = case when v_done then now() else null end
   where pick_id = v_pick
     and user_id = v_user
     and (finished_at is not null) is distinct from v_done;
  return null;
end;
$$;

comment on function private.sync_participant_finished() is
  'Keeps pick_participants.finished_at in step with whether the participant answered every candidate.';

revoke all on function private.sync_participant_finished() from public, anon, authenticated;

create trigger preferences_sync_finished
  after insert or delete on public.preferences
  for each row execute function private.sync_participant_finished();

-- A table in a publication that publishes UPDATE/DELETE needs a replica identity, or Postgres
-- rejects every UPDATE on it (55000), including the finished_at update above. picks has a
-- primary key; pick_participants doesn't, so use its unique (pick_id, user_id) index (both
-- columns are not null). Found by Razin on `supabase db reset` (docs/bugs.md #18).
alter table public.pick_participants
  replica identity using index pick_participants_pick_user_key;

-- Realtime: add the two tables only if the publication exists (it does on Supabase and in
-- `supabase start`) and they aren't members yet, so a re-run or a teammate's migration that
-- adds them too doesn't fail.
do $$
declare
  v_table text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  foreach v_table in array array['picks', 'pick_participants'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end;
$$;
