-- Two Pick-flow fixes (Mike).
-- * pick_leave: a guest can leave a Pick that hasn't finished. Their swipes, ballot and
--   availability go with them (on delete cascade), so they stop counting toward "everyone's
--   done" and the Pick leaves their Active list. The host cancels instead.
-- * pick_start_checked: start commits only if the Pick still has the people the deck was built
--   for, and saves a wider area (lifecycle.ts widens one with no places) in the same
--   transaction, so a failed or losing start leaves the draft's area alone.
-- * pick_close_vote_apply with ballots and voters: the tally only settles if what it counted
--   is still the vote, so a guest who leaves (voted or not) or changes their vote mid-tally
--   is recounted, and the winner notice goes to who is there.
-- * A scheduled Pick whose last eligible voter leaves the final vote is canceled, like an
--   empty swipe round (0043), instead of declaring a winner nobody voted for.
-- * Group and block removals lock the Pick before its participant rows, the same order as
--   pick_leave and the empty-round trigger, so they can't deadlock each other.

create function public.pick_leave(p_pick_id text, p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_pick public.picks%rowtype;
begin
  select * into v_pick from public.picks where id = private.try_uuid(p_pick_id) for update;
  if not found or not exists (select 1 from public.pick_participants
                              where pick_id = v_pick.id and user_id = p_user_id) then
    raise exception using errcode = 'PT404', message = 'Pick not found';
  end if;
  if v_pick.host_id = p_user_id then
    raise exception using errcode = 'PT409', message = 'The host cancels the Pick instead';
  end if;
  if v_pick.state not in ('draft', 'swiping', 'final_vote') then
    raise exception using errcode = 'PT409', message = 'This Pick is already over';
  end if;
  delete from public.pick_participants where pick_id = v_pick.id and user_id = p_user_id;
  update public.picks set updated_at = now() where id = v_pick.id;
end $$;

create function public.pick_start_checked(
  p_pick_id text, p_user_id uuid, p_candidates jsonb, p_radius_m integer, p_participant_ids uuid[]
) returns boolean
language plpgsql set search_path = '' as $$
declare
  v_pick public.picks;
begin
  -- Joins, leaves and removals all take this lock, so the roster can't change before commit.
  select * into v_pick from public.picks where id = private.try_uuid(p_pick_id) for update;
  if not found or v_pick.host_id is distinct from p_user_id or v_pick.state <> 'draft' then
    raise exception using errcode = 'PT409', message = 'Pick must be draft to start';
  end if;
  if (select coalesce(array_agg(user_id order by user_id), '{}') from public.pick_participants
       where pick_id = v_pick.id)
     is distinct from (select coalesce(array_agg(u order by u), '{}') from unnest(p_participant_ids) u)
  then
    return false;
  end if;
  update public.picks set radius_m = p_radius_m
   where id = v_pick.id and radius_m is distinct from p_radius_m;
  perform public.pick_start(p_pick_id, p_user_id, p_candidates);
  return true;
end $$;

-- Arrays compared as sets: elements in a canonical order.
create function private.jsonb_sorted(p jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(e order by e::text), '[]'::jsonb)
    from jsonb_array_elements(coalesce(p, '[]'::jsonb)) e
$$;

create function public.pick_close_vote_apply(
  p_pick_id text, p_winner_place_id text, p_decided_by text, p_ballots jsonb,
  p_participant_ids jsonb
) returns text
language plpgsql set search_path = '' as $$
declare
  v_state public.pick_state;
  v_now jsonb;
begin
  -- pick_cast_vote and pick_leave take this lock too, so the vote can't change under it.
  select state into v_state from public.picks where id = private.try_uuid(p_pick_id) for update;
  if not found or v_state <> 'final_vote' then return 'closed'; end if;
  -- The same snapshot the tally read (scheduled Picks count only the eligible cohort).
  v_now := public.pick_load_for_vote(p_pick_id);
  if jsonb_array_length(v_now->'participantIds') = 0 then return 'closed'; end if;
  if private.jsonb_sorted(v_now->'ballots') <> private.jsonb_sorted(p_ballots)
     or private.jsonb_sorted(v_now->'participantIds') <> private.jsonb_sorted(p_participant_ids) then
    return 'stale';
  end if;
  perform public.pick_close_vote_apply(p_pick_id, p_winner_place_id, p_decided_by);
  if exists (select 1 from public.picks where id = private.try_uuid(p_pick_id)
    and state = 'completed' and winner_place_id = p_winner_place_id) then
    return 'committed';
  end if;
  return 'closed';
end $$;

create or replace function private.cancel_empty_scheduled_round() returns trigger
language plpgsql security definer set search_path = '' as $$
declare p public.picks;
begin
 select * into p from public.picks where id=old.pick_id for update;
 if not found or p.proposed_at is null or p.state not in ('swiping','final_vote') then return old; end if;
 if (p.state='swiping' and cardinality(private.availability_eligible_ids(p.id))=0)
  or (p.state='final_vote' and not exists(select 1 from public.pick_voting_cohort c
       where c.pick_id=p.id and private.availability_access(p.id,c.user_id))) then
  update public.picks set state='canceled',
   cancel_reason='No eligible participants remain in this Pick.' where id=p.id;
 end if;
 return old;
end $$;

create or replace function private.availability_revoke_group() returns trigger
language plpgsql security definer set search_path='' as $$ begin
 perform 1 from public.picks where proposed_at is not null and group_id=old.group_id
  and state not in ('completed','canceled') order by id for update;
 update public.picks set state='canceled' where proposed_at is not null and group_id=old.group_id and host_id=old.user_id and state not in ('completed','canceled');
 delete from public.pick_participants pp using public.picks p where pp.pick_id=p.id and p.proposed_at is not null and p.group_id=old.group_id and p.state not in ('completed','canceled') and pp.user_id=old.user_id;
 return old;
end $$;

create or replace function private.availability_revoke_block() returns trigger
language plpgsql security definer set search_path='' as $$ begin
 perform 1 from public.picks p where p.proposed_at is not null and p.state not in ('completed','canceled')
  and p.host_id in (new.blocker_id, new.blocked_id) order by p.id for update;
 delete from public.pick_participants pp using public.picks p where pp.pick_id=p.id and p.proposed_at is not null and p.state not in ('completed','canceled')
  and ((p.host_id=new.blocker_id and pp.user_id=new.blocked_id) or (p.host_id=new.blocked_id and pp.user_id=new.blocker_id));
 return new;
end $$;

revoke all on function public.pick_leave(text, uuid),
  public.pick_start_checked(text, uuid, jsonb, integer, uuid[]),
  public.pick_close_vote_apply(text, text, text, jsonb, jsonb), private.jsonb_sorted(jsonb)
  from public, anon, authenticated;
grant execute on function public.pick_leave(text, uuid),
  public.pick_start_checked(text, uuid, jsonb, integer, uuid[]),
  public.pick_close_vote_apply(text, text, text, jsonb, jsonb), private.jsonb_sorted(jsonb)
  to service_role;
