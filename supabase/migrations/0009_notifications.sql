-- Notifications, push tokens, and a cancel reason (Alan, M4).
-- Contract: supabase/functions/_shared/api/notify.ts, supabase/functions/api/notifyStore.ts,
-- docs/api-integration.md.
--
-- Same discipline as 0002–0006: clients only SELECT (their own notifications); every
-- write goes through a SECURITY INVOKER RPC executable only by service_role.
--
-- Every Pick event reaches each person at most once (a unique index, not app logic), so a
-- retried close, two racing vote settles, or a sweep that runs every minute can never
-- send the same push twice. The one exception is plan_time_set: a host may move the time.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null check (type in (
    'added_to_pick', 'pick_started', 'reminder', 'vote_needed', 'winner_decided',
    'pick_canceled', 'plan_time_set', 'plan_reminder', 'did_you_go'
  )),
  pick_id uuid references public.picks (id) on delete cascade,
  -- Small and display-only (e.g. a cancel reason). Never answers or scores.
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 1024),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
comment on table public.notifications is
  'In-app inbox. Readable by its owner only; written only by the API (notify()).';
create index notifications_user_created_idx on public.notifications (user_id, created_at desc);
create unique index notifications_once_per_pick on public.notifications (user_id, pick_id, type)
  where pick_id is not null and type <> 'plan_time_set';

-- One row per device. The token is the key, so a phone that signs in to another account
-- moves to that account instead of notifying both.
create table public.push_tokens (
  token text primary key check (token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{1,200}\]$'),
  user_id uuid not null references public.profiles (id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  updated_at timestamptz not null default now()
);
comment on table public.push_tokens is 'Expo push tokens. No client access at all; API only.';
create index push_tokens_user_id_idx on public.push_tokens (user_id);

-- Why the host canceled (shown in the inbox, never in push text).
alter table public.picks
  add column cancel_reason text check (cancel_reason is null or char_length(cancel_reason) between 1 and 200);

-- ---------------------------------------------------------------------------
-- RLS: my own notifications only. push_tokens has RLS on and no policy.
-- ---------------------------------------------------------------------------
alter table public.notifications enable row level security;
alter table public.push_tokens enable row level security;

create policy "notifications: only my own" on public.notifications
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on table public.notifications, public.push_tokens from anon, authenticated;
grant select on table public.notifications to authenticated;
grant all on table public.notifications, public.push_tokens to service_role;

-- ---------------------------------------------------------------------------
-- RPCs (service_role only)
-- ---------------------------------------------------------------------------

-- Inserts one row per user and returns the users who actually got a new row, so the API
-- pushes only to them. Unknown users (a deleted account) are skipped, not an error.
create function public.notify_insert(
  p_user_ids uuid[], p_type text, p_pick_id uuid, p_payload jsonb
)
returns setof uuid
language sql
set search_path = ''
as $$
  insert into public.notifications (user_id, type, pick_id, payload)
  select ids.u, p_type, p_pick_id, coalesce(p_payload, '{}'::jsonb)
  from (select distinct unnest(p_user_ids) as u) ids
  where exists (select 1 from public.profiles where id = ids.u)
  on conflict (user_id, pick_id, type) where pick_id is not null and type <> 'plan_time_set'
    do nothing
  returning user_id;
$$;

create function public.notification_mark_read(p_id uuid, p_user_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.notifications set read_at = coalesce(read_at, now())
  where id = p_id and user_id = p_user_id;
  if not found then
    raise exception using errcode = 'PT404', message = 'Notification not found';
  end if;
end;
$$;

create function public.push_token_register(p_user_id uuid, p_token text, p_platform text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  insert into public.push_tokens (token, user_id, platform)
  values (p_token, p_user_id, p_platform)
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
exception
  when foreign_key_violation then
    raise exception using errcode = 'PT403', message = 'No profile for this user';
end;
$$;

-- Participants who haven't finished swiping a Pick whose deadline falls inside the window
-- and who haven't been reminded yet. notify_insert's unique index is the real guard.
create function public.pick_reminder_targets(p_from timestamptz, p_until timestamptz)
returns table (pick_id uuid, user_ids uuid[])
language sql
stable
set search_path = ''
as $$
  select p.id, array_agg(pp.user_id order by pp.user_id)
  from public.picks p
  join public.pick_participants pp on pp.pick_id = p.id and pp.finished_at is null
  where p.state = 'swiping' and p.deadline_at > p_from and p.deadline_at <= p_until
    and not exists (
      select 1 from public.notifications n
      where n.pick_id = p.id and n.user_id = pp.user_id and n.type = 'reminder'
    )
  group by p.id
  order by p.id
  limit 200;
$$;

-- pick_cancel gains an optional reason. Same rules as 0003.
drop function public.pick_cancel(text, uuid);
create function public.pick_cancel(p_pick_id text, p_user_id uuid, p_reason text default null)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid := private.try_uuid(p_pick_id);
  v_pick public.picks%rowtype;
begin
  select * into v_pick from public.picks where id = v_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'Pick not found';
  end if;
  if v_pick.host_id <> p_user_id then
    raise exception using errcode = 'PT403', message = 'Only the host can cancel this Pick';
  end if;
  if v_pick.state in ('completed', 'canceled') then
    raise exception using errcode = 'PT409', message = 'This Pick can no longer be canceled';
  end if;
  update public.picks set state = 'canceled', cancel_reason = nullif(btrim(p_reason), '')
  where id = v_id;
end;
$$;

revoke all on function public.notify_insert(uuid[], text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.notification_mark_read(uuid, uuid) from public, anon, authenticated;
revoke all on function public.push_token_register(uuid, text, text) from public, anon, authenticated;
revoke all on function public.pick_reminder_targets(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.pick_cancel(text, uuid, text) from public, anon, authenticated;
grant execute on function public.notify_insert(uuid[], text, uuid, jsonb) to service_role;
grant execute on function public.notification_mark_read(uuid, uuid) to service_role;
grant execute on function public.push_token_register(uuid, text, text) to service_role;
grant execute on function public.pick_reminder_targets(timestamptz, timestamptz) to service_role;
grant execute on function public.pick_cancel(text, uuid, text) to service_role;
