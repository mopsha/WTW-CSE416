-- Two Pick-flow fixes (Mike).
-- * pick_leave: a guest can leave a Pick that hasn't finished. Their swipes, ballot and
--   availability go with them (on delete cascade), so they stop counting toward "everyone's
--   done" and the Pick leaves their Active list. The host cancels instead.
-- * pick_start_at_radius: when the area has no places, start widens it (lifecycle.ts) and saves
--   the radius it used in the same transaction as the deck, so a failed or losing start
--   leaves the draft's area alone.
-- * pick_close_vote_apply with ballots: the tally only settles if the ballots it counted are
--   still the ballots, so a guest who leaves (or changes their vote) mid-tally isn't counted.
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

create function public.pick_start_at_radius(
  p_pick_id text, p_user_id uuid, p_candidates jsonb, p_radius_m integer
) returns void
language plpgsql set search_path = '' as $$ begin
  -- The row lock makes a racing start wait, then fail pick_start's draft check, so only the
  -- winning deck's radius is saved. Any failure rolls the radius back with it.
  update public.picks set radius_m = p_radius_m
   where id = private.try_uuid(p_pick_id) and host_id = p_user_id and state = 'draft';
  if not found then
    raise exception using errcode = 'PT409', message = 'Pick must be draft to start';
  end if;
  perform public.pick_start(p_pick_id, p_user_id, p_candidates);
end $$;

create function public.pick_close_vote_apply(
  p_pick_id text, p_winner_place_id text, p_decided_by text, p_ballots jsonb
) returns boolean
language plpgsql set search_path = '' as $$
declare
  v_id uuid := private.try_uuid(p_pick_id);
  v_state public.pick_state;
begin
  -- pick_cast_vote and pick_leave take this lock too, so the ballots can't change under it.
  select state into v_state from public.picks where id = v_id for update;
  if not found or v_state <> 'final_vote' then return true; end if;
  if (select coalesce(jsonb_agg(jsonb_build_object('userId', user_id, 'placeId', place_id)
                                order by user_id::text), '[]'::jsonb)
        from public.final_votes where pick_id = v_id)
     <> (select coalesce(jsonb_agg(b order by b->>'userId'), '[]'::jsonb)
           from jsonb_array_elements(coalesce(p_ballots, '[]'::jsonb)) b) then
    return false;
  end if;
  perform public.pick_close_vote_apply(p_pick_id, p_winner_place_id, p_decided_by);
  return true;
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
  public.pick_start_at_radius(text, uuid, jsonb, integer),
  public.pick_close_vote_apply(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.pick_leave(text, uuid),
  public.pick_start_at_radius(text, uuid, jsonb, integer),
  public.pick_close_vote_apply(text, text, text, jsonb) to service_role;
