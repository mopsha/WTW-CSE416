alter table public.friendships add column activity_key uuid not null default gen_random_uuid() unique;

alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'direct_message', 'group_message', 'group_invite', 'hang_invite', 'added_to_pick',
  'pick_started', 'reminder', 'vote_needed', 'winner_decided', 'pick_canceled',
  'plan_time_set', 'time_suggested', 'plan_reminder', 'did_you_go',
  'friend_request', 'friend_accepted', 'hang_rsvp'
));
create unique index notifications_friend_activity on public.notifications
  (user_id, type, (payload->>'friendshipKey')) where type in ('friend_request', 'friend_accepted');
create unique index notifications_hang_rsvp on public.notifications
  (user_id, (payload->>'hangId')) where type = 'hang_rsvp';

-- Group ordering can change without changing the historical creation time.
alter table public.notifications add column activity_at timestamptz;
create index notifications_activity_order on public.notifications
  (user_id, (coalesce(activity_at, created_at)) desc, id desc);

-- A per-owner revision invalidates a cursor if a group moves between pages.
-- Unlike a timestamp watermark, it also handles writes that commit out of order.
create table private.activity_order_versions (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  version bigint not null
);
revoke all on private.activity_order_versions from public,anon,authenticated;
grant select,insert,update on private.activity_order_versions to service_role;

-- The friendship write owns the event, including acceptance via a reciprocal request.
create function private.record_friend_activity() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'pending' and new.username_requested then
    insert into public.notifications(user_id, type, payload)
    values (new.addressee_id, 'friend_request', jsonb_build_object('friendshipKey', new.activity_key))
    on conflict do nothing;
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'accepted' then
    insert into public.notifications(user_id, type, payload)
    values (new.requester_id, 'friend_accepted', jsonb_build_object('friendshipKey', new.activity_key))
    on conflict do nothing;
  end if;
  return null;
end;
$$;
create trigger record_friend_activity after insert or update of status, username_requested
on public.friendships for each row execute function private.record_friend_activity();

-- Return only a newly recorded incoming request ID, using the same profile lock
-- order as friend_request_username. The Edge Function sends after this commits.
create function public.friend_request_activity(p_user_id uuid, p_username text, p_target_id uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare
  result jsonb;
  previous_id uuid;
  current_id uuid;
begin
  perform 1 from public.profiles where id in (p_user_id, p_target_id) order by id for update;
  select n.id into previous_id from public.friendships f
  join public.notifications n on n.user_id = f.addressee_id and n.type = 'friend_request'
    and n.payload->>'friendshipKey' = f.activity_key::text
  where f.requester_id = p_user_id and f.addressee_id = p_target_id;

  result := public.friend_request_username(p_user_id, p_username, p_target_id);
  if result->>'relationship' = 'requested' then
    select n.id into current_id from public.friendships f
    join public.notifications n on n.user_id = f.addressee_id and n.type = 'friend_request'
      and n.payload->>'friendshipKey' = f.activity_key::text
    where f.requester_id = p_user_id and f.addressee_id = p_target_id and f.status = 'pending';
    if current_id is not null and current_id is distinct from previous_id then
      result := result || jsonb_build_object('notificationId', current_id);
    end if;
  end if;
  return result;
end;
$$;

-- RSVP identities follow the same audience rules as Hang attendees. A negative
-- reply counts toward the group summary without identifying who declined.
create function private.activity_hang_replies(p_hang uuid, p_owner uuid)
returns table (user_id uuid, status text)
language sql stable set search_path = '' as $$
  select r.user_id, r.status
  from public.hang_posts h
  join public.hang_responses r on r.post_id = h.id
  join public.profiles actor on actor.id = r.user_id and not actor.avatar_deletion_pending
  where h.id = p_hang and h.author_id = p_owner and h.expires_at > now()
    and r.user_id <> p_owner
    and private.can_view_hang(h.id, r.user_id)
    and not private.is_blocked_between(p_owner, r.user_id)
    and (h.recipient_snapshot or h.audience <> 'group' or exists (
      select 1 from public.group_members m where m.group_id = h.group_id and m.user_id = p_owner
    ))
$$;

create function private.record_hang_activity() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_owner uuid;
begin
  if tg_op = 'UPDATE' and old.status = new.status then return null; end if;
  insert into public.notifications as n(user_id, type, payload, activity_at)
  select h.author_id, 'hang_rsvp', jsonb_build_object('hangId', h.id), clock_timestamp()
  from public.hang_posts h
  join public.profiles owner on owner.id = h.author_id and not owner.avatar_deletion_pending
  where h.id = new.post_id
    and exists (
      select 1 from private.activity_hang_replies(h.id, h.author_id) r where r.user_id = new.user_id
    )
  on conflict (user_id, (payload->>'hangId')) where type = 'hang_rsvp'
  do update set read_at = null,
    activity_at = greatest(excluded.activity_at, n.activity_at + interval '1 microsecond')
  returning user_id into v_owner;
  if found then
    insert into private.activity_order_versions as v(user_id, version) values (v_owner, 1)
    on conflict (user_id) do update set version = v.version + 1;
  end if;
  return null;
end;
$$;
create trigger record_hang_activity after insert or update of status
on public.hang_responses for each row execute function private.record_hang_activity();

alter function private.notification_relevant(public.notifications,boolean,timestamptz)
rename to notification_relevant_phase1;
create function private.notification_relevant(
  n public.notifications, p_push boolean, v_now timestamptz default statement_timestamp()
) returns boolean language plpgsql stable set search_path = '' as $$
begin
  if n.type not in ('friend_request', 'friend_accepted', 'hang_rsvp') then
    return private.notification_relevant_phase1(n, p_push, v_now);
  end if;
  if not exists (select 1 from public.profiles where id = n.user_id and not avatar_deletion_pending)
    or (p_push and (n.read_at is not null or n.type <> 'friend_request')) then
    return false;
  end if;
  if n.type = 'hang_rsvp' then
    return exists (select 1 from private.activity_hang_replies(private.try_uuid(n.payload->>'hangId'), n.user_id));
  end if;
  return exists (
    select 1 from public.friendships f
    join public.profiles actor on actor.id = case when n.type = 'friend_request' then f.requester_id else f.addressee_id end
      and not actor.avatar_deletion_pending
    where f.activity_key = private.try_uuid(n.payload->>'friendshipKey')
      and not private.is_blocked_between(f.requester_id, f.addressee_id)
      and ((n.type = 'friend_request' and f.status = 'pending' and f.username_requested and f.addressee_id = n.user_id)
        or (n.type = 'friend_accepted' and f.status = 'accepted' and f.requester_id = n.user_id))
  );
end;
$$;

-- Request only metadata for the current, owner-scoped page. No message bodies,
-- photo URLs, or client-supplied display text are projected.
create function private.activity_details(p_user uuid, p_rows public.notifications[])
returns table (id uuid, activity jsonb)
language sql stable set search_path = '' as $$
  select n.id, jsonb_strip_nulls(jsonb_build_object(
    'actorId', actor.id, 'actorName', actor.display_name, 'groupName', g.name,
    'hangName', h.activity, 'winnerName', c.snapshot->>'name',
    'replyCount', replies.reply_count, 'replyStatus', replies.reply_status,
    'otherReplyCount', replies.total_count - replies.reply_count,
    'avatarRef', case when actor.avatar_path is not null and private.can_view_avatar(p_user, actor.id)
      then jsonb_build_object('userId', actor.id, 'revision', actor.avatar_revision) end
  ))
  from unnest(p_rows) n
  left join public.friendships f on n.type in ('friend_request', 'friend_accepted')
    and f.activity_key = private.try_uuid(n.payload->>'friendshipKey')
  left join public.group_invitations i on n.type = 'group_invite' and i.id = private.try_uuid(n.payload->>'inviteId')
  left join public.group_messages gm on gm.id = n.group_message_id
  left join public.direct_messages dm on dm.id = n.direct_message_id
  left join public.picks p on p.id = n.pick_id
  left join public.hang_posts h on n.type in ('hang_invite', 'hang_rsvp')
    and h.id = private.try_uuid(n.payload->>'hangId')
  left join public.groups g on g.id = coalesce(i.group_id, gm.group_id, p.group_id)
  left join public.pick_candidates c on n.type = 'winner_decided'
    and c.pick_id = p.id and c.place_id = p.winner_place_id and c.source <> 'google'
  left join lateral (
    select r.status reply_status, count(*) reply_count, sum(count(*)) over () total_count,
      case when r.status <> 'cant' then (array_agg(r.user_id order by r.user_id))[1] end actor_id
    from private.activity_hang_replies(h.id, p_user) r
    where n.type = 'hang_rsvp'
    group by r.status
    order by case r.status when 'down' then 0 when 'maybe' then 1 else 2 end
    limit 1
  ) replies on n.type = 'hang_rsvp'
  left join public.profiles actor on actor.id = case n.type
    when 'friend_request' then f.requester_id
    when 'friend_accepted' then f.addressee_id
    when 'group_invite' then i.inviter_id
    when 'group_message' then gm.sender_id
    when 'direct_message' then dm.sender_id
    when 'hang_invite' then h.author_id
    when 'hang_rsvp' then replies.actor_id
    when 'pick_started' then p.host_id
    when 'pick_canceled' then p.host_id
  end and not actor.avatar_deletion_pending
$$;

revoke all on function private.record_friend_activity(), private.record_hang_activity(),
  private.activity_hang_replies(uuid,uuid), private.notification_relevant(public.notifications,boolean,timestamptz),
  public.friend_request_activity(uuid,text,uuid), private.activity_details(uuid,public.notifications[])
from public,anon,authenticated;
grant execute on function private.activity_hang_replies(uuid,uuid),
  private.notification_relevant(public.notifications,boolean,timestamptz),
  public.friend_request_activity(uuid,text,uuid), private.activity_details(uuid,public.notifications[])
to service_role;

-- Shared page selection for the legacy SQL projection and combined API snapshot.
create function private.activity_page(
  p_user uuid, p_limit integer, p_before timestamptz, p_before_id uuid
) returns setof public.notifications language sql stable set search_path = '' as $$
  select n.* from public.notifications n
  where n.user_id = p_user
    and (p_before is null or (coalesce(n.activity_at, n.created_at), n.id) < (p_before, p_before_id))
    and private.notification_relevant(n, false)
  order by coalesce(n.activity_at, n.created_at) desc, n.id desc
  limit least(greatest(coalesce(p_limit, 0), 0), 51)
$$;

create function public.activity_feed(
  p_user uuid, p_limit integer, p_before timestamptz default null, p_before_id uuid default null
) returns table (id uuid, type text, pick_id uuid, payload jsonb, created_at timestamptz,
  read_at timestamptz, activity jsonb, activity_at timestamptz)
language sql stable set search_path = '' as $$
  with page as materialized (
    select n as item from private.activity_page(p_user, p_limit, p_before, p_before_id) n
  )
  select (n.item).id, (n.item).type, (n.item).pick_id, (n.item).payload,
    (n.item).created_at, (n.item).read_at, a.activity, (n.item).activity_at
  from page n join private.activity_details(p_user, array(select item from page)) a on a.id = (n.item).id
  order by coalesce((n.item).activity_at, (n.item).created_at) desc, (n.item).id desc
$$;

create function public.activity_revalidate(p_user uuid, p_ids uuid[])
returns table (id uuid, type text, pick_id uuid, payload jsonb, created_at timestamptz,
  read_at timestamptz, activity jsonb, activity_at timestamptz)
language sql stable set search_path = '' as $$
  with page as materialized (
    select n as item from public.notification_revalidate(p_user, p_ids) n
  )
  select (n.item).id, (n.item).type, (n.item).pick_id, (n.item).payload,
    (n.item).created_at, (n.item).read_at, a.activity, (n.item).activity_at
  from page n join private.activity_details(p_user, array(select item from page)) a on a.id = (n.item).id
$$;

-- Order revision, page, and loaded rows are checked in one MVCC snapshot.
-- Enrich overlapping IDs once, so both lists contain exactly the same row.
create function public.activity_snapshot(
  p_user uuid, p_ids uuid[], p_limit integer, p_before timestamptz, p_before_id uuid, p_version bigint
) returns jsonb language sql stable set search_path = '' as $$
  with ordering as materialized (
    select coalesce((select v.version from private.activity_order_versions v where v.user_id = p_user), 0) as version
  ), cursor_state as (
    select version, p_before is not null and version <> coalesce(p_version, 0) as reset from ordering
  ), page as materialized (
    select n as item from cursor_state s cross join lateral private.activity_page(
      p_user, p_limit, case when not s.reset then p_before end, p_before_id
    ) n
  ), loaded as materialized (
    select n as item from public.notification_revalidate(p_user,
      case when (select reset from cursor_state) then '{}'::uuid[] else p_ids end
    ) n
  ), combined as (
    select item from page
    union
    select item from loaded
  ), details as materialized (
    select a.id, to_jsonb(c.item) || jsonb_build_object('activity', a.activity) as row,
      coalesce((c.item).activity_at, (c.item).created_at) as sort_at
    from combined c join private.activity_details(p_user, array(select item from combined)) a on a.id = (c.item).id
  )
  select jsonb_build_object(
    'orderVersion', s.version::text,
    'reset', s.reset,
    'page', coalesce((select jsonb_agg(d.row order by d.sort_at desc, d.id desc)
      from page p join details d on d.id = (p.item).id), '[]'::jsonb),
    'notifications', coalesce((select jsonb_agg(d.row)
      from loaded l join details d on d.id = (l.item).id), '[]'::jsonb)
  ) from cursor_state s
$$;

revoke all on function private.activity_page(uuid,integer,timestamptz,uuid),
  public.activity_feed(uuid,integer,timestamptz,uuid), public.activity_revalidate(uuid,uuid[]),
  public.activity_snapshot(uuid,uuid[],integer,timestamptz,uuid,bigint) from public,anon,authenticated;
grant execute on function private.activity_page(uuid,integer,timestamptz,uuid),
  public.activity_feed(uuid,integer,timestamptz,uuid), public.activity_revalidate(uuid,uuid[]),
  public.activity_snapshot(uuid,uuid[],integer,timestamptz,uuid,bigint) to service_role;
