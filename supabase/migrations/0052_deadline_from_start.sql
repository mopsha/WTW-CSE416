-- The swipe clock starts when the host starts the Pick, not when it was created (Mike).
-- The app sends deadlineAt = creation + the chosen length ("30 min", "1 hr"). A host who
-- waits in the lobby for friends to join used to burn that time, and starting after it had
-- passed closed the round on the first swipe. Starting now keeps the chosen length and
-- restarts it from the start. Scheduled Picks (proposed_at) already time it from when
-- availability finishes (0042) and don't go through pick_start's deadline.
-- 0051 is #78 (Google taste signals).

alter function public.pick_start(text, uuid, jsonb) rename to pick_start_before_deadline;
alter function public.pick_start_before_deadline(text, uuid, jsonb) set schema private;
create function public.pick_start(p_pick_id text, p_user_id uuid, p_candidates jsonb) returns void
language plpgsql set search_path = '' as $$ begin
  perform private.pick_start_before_deadline(p_pick_id, p_user_id, p_candidates);
  update public.picks
     set deadline_at = clock_timestamp() + greatest(deadline_at - created_at, interval '5 minutes')
   where id = private.try_uuid(p_pick_id) and proposed_at is null and deadline_at is not null;
end $$;

revoke all on function private.pick_start_before_deadline(text, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.pick_start(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.pick_start(text, uuid, jsonb) to service_role;
