-- Keep legacy audiences and Hang reads. Selected audiences contain send-time grants
-- whose underlying relationship must still be valid at read, RSVP and notification time.
alter table public.hang_posts
  drop constraint hang_posts_audience_check,
  drop constraint hang_posts_check1,
  add constraint hang_posts_audience_check check (audience in ('all_friends', 'group', 'selected')),
  add constraint hang_posts_group_check check (
    audience = 'selected' or (audience = 'group' and group_id is not null)
      or (audience = 'all_friends' and group_id is null)),
  add column request_id uuid,
  add column recipient_snapshot boolean not null default false,
  add unique (author_id, request_id);

create table private.hang_request_fingerprints (
  post_id uuid primary key references public.hang_posts(id) on delete cascade,
  fingerprint bytea not null
);
alter table private.hang_request_fingerprints enable row level security;
revoke all on private.hang_request_fingerprints from public, anon, authenticated;
grant select, insert on private.hang_request_fingerprints to service_role;

create table private.hang_recipient_grants (
  post_id uuid not null references public.hang_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid references public.groups(id) on delete cascade,
  joined_at timestamptz not null,
  author_joined_at timestamptz
);
create index hang_recipient_grants_lookup on private.hang_recipient_grants(post_id, user_id);
alter table private.hang_recipient_grants enable row level security;
revoke all on private.hang_recipient_grants from public, anon, authenticated;
grant select, insert on private.hang_recipient_grants to service_role;

create function private.hang_recipient_eligible(p_id uuid, p_author uuid, p_user uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from private.hang_recipient_grants r
    where r.post_id = p_id and r.user_id = p_user
      and ((r.group_id is null and exists (
        select 1 from public.friendships f
        where f.status = 'accepted' and f.accepted_at = r.joined_at
          and ((f.requester_id = p_author and f.addressee_id = p_user)
            or (f.requester_id = p_user and f.addressee_id = p_author))
      ))
        or exists (
          select 1 from public.group_members author
          join public.group_members recipient on recipient.group_id = author.group_id
          where author.group_id = r.group_id and author.user_id = p_author
            and author.joined_at = r.author_joined_at
            and recipient.user_id = p_user and recipient.joined_at = r.joined_at
        ))
  )
$$;
revoke all on function private.hang_recipient_eligible(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function private.hang_recipient_eligible(uuid, uuid, uuid) to service_role;

create or replace function private.can_view_hang(p_id uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.hang_posts h where h.id = p_id and h.expires_at > now()
      and (h.author_id = p_user or (not private.is_blocked_between(h.author_id, p_user)
        and case
          when h.recipient_snapshot then private.hang_recipient_eligible(h.id, h.author_id, p_user)
          when h.audience = 'all_friends' then private.are_friends(h.author_id, p_user)
          when h.audience = 'group' then exists (select 1 from public.group_members m
                       where m.group_id = h.group_id and m.user_id = p_user)
          else false
        end))
  )
$$;

-- Bind policy checks to the signed-in viewer. The two-argument helper remains
-- available to the service role for authorized lookups, fanout and RSVP counts.
revoke execute on function private.can_view_hang(uuid, uuid) from authenticated;
create function private.can_read_hang(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.can_view_hang(p_id, auth.uid())
$$;
create function private.can_read_hang_response(p_id uuid, p_responder uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.hang_posts h where h.id = p_id
      and (p_responder = auth.uid() or h.author_id = auth.uid())
      and private.can_view_hang(p_id, auth.uid())
      and private.can_view_hang(p_id, p_responder)
  )
$$;
revoke all on function private.can_read_hang(uuid), private.can_read_hang_response(uuid, uuid)
  from public, anon;
grant execute on function private.can_read_hang(uuid), private.can_read_hang_response(uuid, uuid)
  to authenticated;
alter policy "hang: visible active posts" on public.hang_posts using (private.can_read_hang(id));
alter policy "hang responses: own or author, currently eligible" on public.hang_responses
  using (private.can_read_hang_response(post_id, user_id));

create or replace function public.hang_access(p_id uuid, p_user uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'blocked', private.is_blocked_between(h.author_id, p_user),
    'acceptedFriends', private.are_friends(h.author_id, p_user),
    'groupMember', exists (select 1 from public.group_members m
                           where m.group_id = h.group_id and m.user_id = p_user),
    'selectedRecipient', case when h.recipient_snapshot
      then private.hang_recipient_eligible(h.id, h.author_id, p_user) end
  ) from public.hang_posts h where h.id = p_id
$$;

create or replace function private.hang_json(p_id uuid, p_user uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', h.id, 'authorId', h.author_id,
    'authorName', (select display_name from public.profiles where id = h.author_id),
    'activity', h.activity, 'startsAt', h.starts_at, 'expiresAt', h.expires_at,
    'audience', h.audience, 'groupId', h.group_id, 'pickId', h.pick_id,
    'myStatus', responses.mine, 'downCount', responses.down, 'maybeCount', responses.maybe,
    'cantCount', responses.cant
  )
  from public.hang_posts h
  cross join lateral (
    select max(r.status) filter (where r.user_id = p_user) as mine,
      count(*) filter (where r.status = 'down') as down,
      count(*) filter (where r.status = 'maybe') as maybe,
      count(*) filter (where r.status = 'cant') as cant
    from public.hang_responses r
    where r.post_id = h.id and private.can_view_hang(h.id, r.user_id)
  ) responses
  where h.id = p_id and private.can_view_hang(h.id, p_user)
$$;

create or replace function public.hang_create(p_user uuid, p_input jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_id uuid;
  v_request uuid := (p_input->>'requestId')::uuid;
  v_audience text := p_input->>'audience';
  v_group uuid := (p_input->>'groupId')::uuid;
  v_groups uuid[] := array(select distinct value::uuid
    from jsonb_array_elements_text(p_input->'groupIds') order by value::uuid);
  v_friends uuid[] := array(select distinct value::uuid
    from jsonb_array_elements_text(p_input->'friendIds') order by value::uuid);
  v_activity text := regexp_replace(p_input->>'activity', '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_now boolean := coalesce((p_input->>'startNow')::boolean, false);
  v_fingerprint bytea;
  v_created timestamptz;
  v_start timestamptz := (p_input->>'startsAt')::timestamptz;
  v_expires timestamptz := (p_input->>'expiresAt')::timestamptz;
  v_post jsonb;
  v_notified jsonb;
begin
  if v_request is not null then
    -- Hash a canonical payload. Epoch values are independent of session timezone.
    v_fingerprint := sha256(convert_to(jsonb_build_array(
      v_activity, v_audience, v_group, v_groups, v_friends, v_now,
      case when not v_now then extract(epoch from v_start) end,
      case when not v_now then extract(epoch from v_expires) end
    )::text, 'UTF8'));
    perform pg_advisory_xact_lock(hashtextextended(p_user::text || ':' || v_request::text, 0));
    select id into v_id from public.hang_posts where author_id = p_user and request_id = v_request;
    if found then
      if not exists (select 1 from private.hang_request_fingerprints
                     where post_id = v_id and fingerprint = v_fingerprint) then
        raise exception using errcode = 'PT409', hint = 'request_mismatch',
          message = 'This send was already used for a different Hang.';
      end if;
      v_post := private.hang_json(v_id, p_user);
      if v_post is null then
        raise exception using errcode = 'PT409', message = 'This Hang was already sent and has ended.';
      end if;
    end if;
  end if;

  if v_id is null then
    if v_audience = 'selected' then
      if v_request is null then
        raise exception using errcode = 'PT400', message = 'Choose a valid audience.';
      end if;
      if cardinality(v_groups) > 100 or cardinality(v_friends) > 100
        or cardinality(v_groups) + cardinality(v_friends) = 0 then
        raise exception using errcode = 'PT400', message = 'Choose people to invite.';
      end if;
      if (select count(*) from (
        select group_id from public.group_members
        where user_id = p_user and group_id = any(v_groups) order by group_id for share
      ) memberships) <> cardinality(v_groups) then
        raise exception using errcode = 'PT403', message = 'You’re no longer in one of the selected groups.';
      end if;
      if (select count(*) from (
        select f.requester_id from public.friendships f
        where f.status = 'accepted' and (
          (f.requester_id = p_user and f.addressee_id = any(v_friends))
          or (f.addressee_id = p_user and f.requester_id = any(v_friends))
        ) and not private.is_blocked_between(f.requester_id, f.addressee_id)
        order by f.requester_id, f.addressee_id for share
      ) friendships) <> cardinality(v_friends) then
        raise exception using errcode = 'PT403', message = 'One of the selected friends is no longer available.';
      end if;
      v_group := case when cardinality(v_groups) = 1 and cardinality(v_friends) = 0
        then v_groups[1] end;
    elsif v_audience = 'group' then
      perform 1 from public.group_members where group_id = v_group and user_id = p_user for share;
      if not found then
        raise exception using errcode = 'PT403', message = 'Join this group before posting';
      end if;
      v_groups := array[v_group];
    end if;

    v_created := clock_timestamp();
    if v_now and v_request is not null then
      v_start := v_created;
      v_expires := v_created + interval '4 hours';
    end if;
    if v_request is not null and (
      v_start is null or not isfinite(v_start) or v_start < v_created
      or v_start > v_created + interval '168 hours'
      or v_expires is null or not isfinite(v_expires)
      or v_expires <= v_start or v_expires > v_start + interval '24 hours'
    ) then
      raise exception using errcode = 'PT400', message = 'Choose a future date and time within 7 days.';
    end if;

    insert into public.hang_posts(author_id, starts_at, expires_at, activity, audience, group_id, request_id, recipient_snapshot)
    values (p_user, v_start, v_expires, v_activity, v_audience, v_group, v_request, true)
    returning id into v_id;

    insert into private.hang_recipient_grants(post_id, user_id, group_id, joined_at, author_joined_at)
    select v_id, m.user_id, m.group_id, m.joined_at, author.joined_at
    from public.group_members m
    join public.group_members author on author.group_id = m.group_id and author.user_id = p_user
    where m.group_id = any(v_groups) and m.user_id <> p_user
      and not private.is_blocked_between(p_user, m.user_id)
    order by m.group_id, m.user_id for share of m;

    insert into private.hang_recipient_grants(post_id, user_id, joined_at)
    select v_id, f.user_id, f.accepted_at
    from (
      select case when requester_id = p_user then addressee_id else requester_id end as user_id, accepted_at
      from public.friendships
      where status = 'accepted' and (
        (requester_id = p_user and (v_audience = 'all_friends' or addressee_id = any(v_friends)))
        or (addressee_id = p_user and (v_audience = 'all_friends' or requester_id = any(v_friends)))
      )
      order by requester_id, addressee_id for share
    ) f where not private.is_blocked_between(p_user, f.user_id);

    if v_request is not null then
      insert into private.hang_request_fingerprints values (v_id, v_fingerprint);
      if not exists (select 1 from private.hang_recipient_grants where post_id = v_id) then
        raise exception using errcode = 'PT400', message = 'Nobody in this audience can receive the Hang.';
      end if;
    end if;
    v_post := private.hang_json(v_id, p_user);
    if v_request is not null then
      with inserted as (
        insert into public.notifications(user_id, type, payload)
        select distinct r.user_id, 'hang_invite', jsonb_build_object('hangId', v_id)
        from private.hang_recipient_grants r where r.post_id = v_id
          and private.can_view_hang(v_id, r.user_id)
        on conflict do nothing returning user_id
      )
      select jsonb_agg(user_id) into v_notified from inserted;
    end if;
  end if;

  if v_request is null then return v_post; end if;
  return v_post || jsonb_build_object('recipientIds', coalesce(v_notified, '[]'::jsonb));
end
$$;

alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'added_to_pick', 'pick_started', 'reminder', 'vote_needed', 'winner_decided', 'pick_canceled',
  'plan_time_set', 'plan_reminder', 'did_you_go', 'group_invite', 'group_message', 'direct_message',
  'time_suggested', 'hang_invite'
));
create unique index notifications_once_per_hang
  on public.notifications(user_id, (payload->>'hangId')) where type = 'hang_invite';
