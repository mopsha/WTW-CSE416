-- The swipe clock starts when the host starts the Pick, not when it was created (Mike).
-- The app sent deadlineAt = creation + the chosen length ("30 min", "1 hr"). A host who
-- waits in the lobby for friends to join used to burn that time, and starting after it had
-- passed closed the round on the first swipe. Now create saves the chosen length
-- (picks.swipe_minutes) and start times it from the database clock, so neither the wait nor
-- the phone's clock changes it. Scheduled Picks (proposed_at) already time it from when
-- availability finishes (0042) and don't go through pick_start's deadline.
-- 0051 is #78 (Google taste signals).

alter table public.picks
  add column swipe_minutes integer check (swipe_minutes between 5 and 10080);

alter function public.pick_create_options(uuid, jsonb) rename to pick_create_before_swipe_length;
alter function public.pick_create_before_swipe_length(uuid, jsonb) set schema private;
create function public.pick_create_options(p_host_id uuid, p_input jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  r jsonb := private.pick_create_before_swipe_length(p_host_id, p_input);
begin
  if p_input->>'proposedAt' is null and p_input->>'deadlineAt' is not null then
    update public.picks set swipe_minutes = (p_input->>'swipeMinutes')::integer
     where id = (r->>'id')::uuid;
  end if;
  return r;
end $$;

alter function public.pick_start(text, uuid, jsonb) rename to pick_start_before_deadline;
alter function public.pick_start_before_deadline(text, uuid, jsonb) set schema private;
create function public.pick_start(p_pick_id text, p_user_id uuid, p_candidates jsonb) returns void
language plpgsql set search_path = '' as $$ begin
  perform private.pick_start_before_deadline(p_pick_id, p_user_id, p_candidates);
  -- Picks made before swipe_minutes existed: snap the stored gap to the picker choice it came
  -- from (legacySwipeMinutes in lifecycle.ts), which absorbs request latency and clock skew.
  update public.picks p
     set deadline_at = clock_timestamp() + make_interval(mins => coalesce(p.swipe_minutes, (
           select coalesce(
             (select c from unnest(array[30, 60, 180, 1440]) c where abs(c - g.mins) <= 5 limit 1),
             greatest(5, (round(g.mins / 5) * 5)::integer))
             from (select extract(epoch from p.deadline_at - p.created_at) / 60 as mins) g)))
   where p.id = private.try_uuid(p_pick_id) and p.proposed_at is null and p.deadline_at is not null;
end $$;

revoke all on function private.pick_create_before_swipe_length(uuid, jsonb),
  private.pick_start_before_deadline(text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.pick_create_options(uuid, jsonb), public.pick_start(text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.pick_create_options(uuid, jsonb), public.pick_start(text, uuid, jsonb)
  to service_role;
