-- Two Pick-flow fixes (Mike).
-- * pick_leave: a guest can leave a Pick that hasn't finished. Their swipes, ballot and
--   availability go with them (on delete cascade), so they stop counting toward "everyone's
--   done" and the Pick leaves their Active list. The host cancels instead.
-- * pick_set_radius: when the area has no places, start widens it (lifecycle.ts) and saves the
--   radius it used, so the live reads and the lobby match the deck. Draft and host only.

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

create function public.pick_set_radius(p_pick_id text, p_user_id uuid, p_radius_m integer)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.picks set radius_m = p_radius_m, updated_at = now()
   where id = private.try_uuid(p_pick_id) and host_id = p_user_id and state = 'draft';
  if not found then
    raise exception using errcode = 'PT409', message = 'Pick must be draft to change its area';
  end if;
end $$;

revoke all on function public.pick_leave(text, uuid), public.pick_set_radius(text, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.pick_leave(text, uuid), public.pick_set_radius(text, uuid, integer)
  to service_role;
