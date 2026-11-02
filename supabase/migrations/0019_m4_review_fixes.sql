-- Review fixes for 0009 and 0013 on integ/m4 (Alan, M4). Runs after 0012, 0015 and 0017,
-- so it can use group_members, the Custom Plan columns and the nullable host directly.

-- ---------------------------------------------------------------------------
-- 1. "One hour left" only for Picks that were open for longer than that. The deadline is set
-- at Create, so a 1-hour Pick was already inside the window when it started, and people got
-- "Time to swipe" and "One hour left" together.
-- ---------------------------------------------------------------------------
create or replace function public.pick_reminder_targets(p_from timestamptz, p_until timestamptz)
returns table (pick_id uuid, user_ids uuid[])
language sql
stable
set search_path = ''
as $$
  select p.id, array_agg(pp.user_id order by pp.user_id)
  from public.picks p
  join public.pick_participants pp on pp.pick_id = p.id and pp.finished_at is null
  where p.state = 'swiping' and p.deadline_at > p_from and p.deadline_at <= p_until
    and p.deadline_at - p.created_at > interval '2 hours'
    and not exists (
      select 1 from public.notifications n
      where n.pick_id = p.id and n.user_id = pp.user_id and n.type = 'reminder'
    )
  group by p.id
  order by p.id
  limit 200;
$$;

-- ---------------------------------------------------------------------------
-- 2. At most 10 devices per account: registering an 11th drops the oldest.
-- ---------------------------------------------------------------------------
create or replace function public.push_token_register(p_user_id uuid, p_token text, p_platform text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  insert into public.push_tokens (token, user_id, platform)
  values (p_token, p_user_id, p_platform)
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
  delete from public.push_tokens
  where user_id = p_user_id and token in (
    select token from public.push_tokens where user_id = p_user_id
    order by updated_at desc offset 10
  );
exception
  when foreign_key_violation then
    raise exception using errcode = 'PT403', message = 'No profile for this user';
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. "Did you go?" only for Picks decided after this ships, so the first sweep doesn't prompt
-- two weeks of old Picks (and skew the M5 "went" metric).
-- ---------------------------------------------------------------------------
create table private.feature_launches (
  feature text primary key,
  launched_at timestamptz not null default now()
);
insert into private.feature_launches (feature) values ('did_you_go');
revoke all on table private.feature_launches from public, anon, authenticated;
grant select on table private.feature_launches to service_role;

create or replace function public.pick_plan_targets(p_now timestamptz)
returns table (pick_id uuid, kind text, user_ids uuid[])
language sql
stable
set search_path = ''
as $$
  with due as (
    select p.id, 'plan_reminder'::text as kind from public.picks p
    where p.state = 'completed' and p.plan_at > p_now and p.plan_at <= p_now + interval '1 hour'
    union all
    select p.id, 'did_you_go' from public.picks p
    where p.state = 'completed' and coalesce(p.plan_at, p.decided_at) > p_now - interval '14 days'
      and coalesce(p.plan_at + interval '3 hours', p.decided_at + interval '24 hours') <= p_now
      and p.decided_at >= (select launched_at from private.feature_launches where feature = 'did_you_go')
  )
  select d.id, d.kind, array_agg(pp.user_id order by pp.user_id)
  from due d
  join public.pick_participants pp on pp.pick_id = d.id
  where not exists (
      select 1 from public.pick_rsvps r
      where r.pick_id = d.id and r.user_id = pp.user_id and r.status = 'not_going')
    and not exists (
      select 1 from public.notifications n
      where n.pick_id = d.id and n.user_id = pp.user_id and n.type = d.kind)
    and (d.kind <> 'did_you_go' or not exists (
      select 1 from public.pick_outcomes o where o.pick_id = d.id and o.user_id = pp.user_id))
  group by d.id, d.kind
  order by d.id, d.kind
  limit 200;
$$;

-- ---------------------------------------------------------------------------
-- 4. Pick again copies every setting (filters and Custom Plan options too), adds back only
-- people still in the group for a group Pick, and returns the existing draft instead of an
-- error when the host taps it twice.
-- ---------------------------------------------------------------------------
create or replace function public.pick_again(p_pick_id text, p_user_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_old public.picks%rowtype := private.lock_pick_as_participant(p_pick_id, p_user_id);
  v_new uuid;
  v_added uuid[];
  v_member boolean;
begin
  if v_old.host_id is distinct from p_user_id then
    raise exception using errcode = 'PT403', message = 'Only the host can pick again';
  end if;
  if v_old.state not in ('completed', 'canceled') then
    raise exception using errcode = 'PT409', message = 'This Pick is still going';
  end if;
  select id into v_new from public.picks where again_of = v_old.id and state = 'draft' limit 1;
  if found then
    return jsonb_build_object('id', v_new, 'addedUserIds', '[]'::jsonb);
  end if;

  v_new := (public.pick_create(p_user_id, v_old.category, v_old.center_lat, v_old.center_lng,
    v_old.radius_m, v_old.pool_size, null, v_old.close_threshold) ->> 'id')::uuid;
  v_member := v_old.group_id is not null and exists (
    select 1 from public.group_members where group_id = v_old.group_id and user_id = p_user_id);
  update public.picks set
    again_of = v_old.id,
    group_id = case when v_member then v_old.group_id end,
    price_max = v_old.price_max,
    open_now = v_old.open_now,
    include_saved = v_old.include_saved,
    custom_options = v_old.custom_options,
    mix_category = v_old.mix_category
  where id = v_new;

  with added as (
    insert into public.pick_participants (pick_id, user_id)
    select v_new, pp.user_id from public.pick_participants pp
    where pp.pick_id = v_old.id and pp.user_id <> p_user_id
      and (v_old.group_id is null or exists (
        select 1 from public.group_members m
        where m.group_id = v_old.group_id and m.user_id = pp.user_id))
    on conflict do nothing
    returning user_id
  )
  select coalesce(array_agg(user_id order by user_id), '{}') into v_added from added;

  return jsonb_build_object('id', v_new, 'addedUserIds', to_jsonb(v_added));
end;
$$;
