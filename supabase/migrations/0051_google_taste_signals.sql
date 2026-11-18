-- Learning from Google places (Alan). Spec: docs/taste-onboarding.md#learning.
-- 0047's triggers learn from a candidate's stored tasteType, which Google places never have
-- (0049 strips it: their types can't be stored). Here the API records Google signals itself
-- with the type it has live, via taste_record_google_signal. What's stored is the same as for
-- every other place: a per-user signal "leaned toward <type>" keyed by a hashed source, never
-- the place's type. The database verifies the action and derives the weight, so a caller can
-- only label an action that really happened, for that user only.
-- 0050 is reserved by the Discover photo-limit PR (#71).

-- When each user last pressed "Reset what WTW learned". A winner is recorded when its Pick is
-- next opened, so without this an old Pick could bring learning back after a reset.
create table private.taste_resets (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  reset_at timestamptz not null default now()
);
revoke all on table private.taste_resets from public, anon, authenticated;

create function public.taste_record_google_signal(p_user_id uuid, p_pick_id text,
  p_place_id text, p_kind text, p_type text) returns void
language plpgsql security definer set search_path = '' set lock_timeout = '200ms' as $$
declare
  v_pick uuid := private.try_uuid(p_pick_id);
  v_weight real;
  v_source uuid;
  v_decided timestamptz;
begin
  if v_pick is null or p_user_id is null or p_type is null or p_type !~ '^[a-z_]{1,60}$' then
    return;
  end if;
  -- Only Google candidates: every other place already learns from its stored tasteType.
  if not exists (select 1 from public.pick_candidates c
                 where c.pick_id = v_pick and c.place_id = p_place_id
                   and c.snapshot ->> 'provider' = 'google') then
    return;
  end if;
  if not exists (select 1 from public.pick_participants
                 where pick_id = v_pick and user_id = p_user_id) then
    return;
  end if;

  if p_kind = 'swipe' then
    -- The weight comes from the swipe actually saved, never from the caller.
    select private.swipe_weight(pr.value) into v_weight from public.preferences pr
      where pr.pick_id = v_pick and pr.place_id = p_place_id and pr.user_id = p_user_id;
    v_source := private.taste_source('swipe', v_pick, p_place_id);
  elsif p_kind = 'vote' then
    if exists (select 1 from public.final_votes v where v.pick_id = v_pick
               and v.user_id = p_user_id and v.place_id = p_place_id) then
      v_weight := 1;
    end if;
    v_source := private.taste_source('vote', v_pick, null);
  elsif p_kind = 'winner' then
    select p.decided_at into v_decided from public.picks p
      where p.id = v_pick and p.winner_place_id = p_place_id;
    -- Not after a reset that came later than the decision.
    if v_decided is not null and not exists (select 1 from private.taste_resets r
        where r.user_id = p_user_id and r.reset_at >= v_decided) then
      v_weight := 2;
    end if;
    v_source := private.taste_source('winner', v_pick, null);
  else
    return;
  end if;
  if v_weight is null then return; end if;

  perform private.learn_taste(p_user_id, v_source, p_type, v_weight);
  -- A winner counts from when the Pick was decided, so opening an old Pick adds a faded
  -- signal, not a fresh one.
  if v_decided is not null then
    update public.taste_signals set at = least(at, v_decided)
      where user_id = p_user_id and source = v_source;
  end if;
exception when others then
  -- Learning is best effort: never fail the swipe, vote or read that called it.
  null;
end $$;

-- "Reset what WTW learned": clears every signal and remembers when, in one transaction.
create function public.taste_reset(p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.taste_signals where user_id = p_user_id;
  insert into private.taste_resets (user_id, reset_at) values (p_user_id, now())
    on conflict (user_id) do update set reset_at = excluded.reset_at;
end $$;

revoke all on function public.taste_record_google_signal(uuid, text, text, text, text),
  public.taste_reset(uuid) from public, anon, authenticated;
grant execute on function public.taste_record_google_signal(uuid, text, text, text, text),
  public.taste_reset(uuid) to service_role;
