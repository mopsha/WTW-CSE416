-- Preserve M4 settings and current group membership when repeating a Pick.
create or replace function public.pick_again(p_pick_id text, p_user_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_old public.picks%rowtype := private.lock_pick_as_participant(p_pick_id, p_user_id);
  v_new uuid;
  v_added uuid[];
  v_group uuid := (to_jsonb(v_old) ->> 'group_id')::uuid;
  v_member boolean := false;
begin
  if v_old.host_id is distinct from p_user_id then
    raise exception using errcode = 'PT403', message = 'Only the host can pick again';
  end if;
  if v_old.state not in ('completed', 'canceled') then
    raise exception using errcode = 'PT409', message = 'This Pick is still going';
  end if;
  if exists (select 1 from public.picks where again_of = v_old.id and state = 'draft') then
    raise exception using errcode = 'PT409', message = 'There is already a new draft for this Pick';
  end if;
  v_new := (public.pick_create(p_user_id, v_old.category, v_old.center_lat, v_old.center_lng,
    v_old.radius_m, v_old.pool_size, null, v_old.close_threshold) ->> 'id')::uuid;
  update public.picks set again_of = v_old.id, price_max = v_old.price_max,
    open_now = v_old.open_now, include_saved = v_old.include_saved,
    custom_options = v_old.custom_options, mix_category = v_old.mix_category
  where id = v_new;

  -- Preserve the historical Pick, but never invite former group members back.
  if v_group is not null then
    select exists (select 1 from public.group_members
      where group_id = v_group and user_id = p_user_id) into v_member;
    if v_member then
      perform public.pick_add_group(v_new, p_user_id, v_group);
    end if;
  end if;

  if v_group is null then
    insert into public.pick_participants (pick_id, user_id)
      select v_new, user_id from public.pick_participants
      where pick_id = v_old.id and user_id <> p_user_id
      on conflict do nothing;
  end if;
  select coalesce(array_agg(user_id order by user_id), '{}') into v_added
    from public.pick_participants where pick_id = v_new and user_id <> p_user_id;

  return jsonb_build_object('id', v_new, 'addedUserIds', to_jsonb(v_added));
end;
$$;

-- The safety cap applies to new memberships, not idempotent retries.
create or replace function private.pick_participants_safety()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host uuid;
begin
  -- ON CONFLICT retries do not consume a slot, even when the Pick is full.
  if exists (select 1 from public.pick_participants
             where pick_id = new.pick_id and user_id = new.user_id) then
    return new;
  end if;
  select host_id into v_host from public.picks where id = new.pick_id;
  if v_host is not null and v_host <> new.user_id and private.is_blocked_between(v_host, new.user_id) then
    return null;
  end if;
  if (select count(*) from public.pick_participants where pick_id = new.pick_id)
     >= private.pick_participant_cap() then
    raise exception using errcode = 'PT409', message = 'This Pick is full', hint = 'pick_full';
  end if;
  return new;
end;
$$;
