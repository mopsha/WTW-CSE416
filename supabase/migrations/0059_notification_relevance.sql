-- Capture the stage on the membership write. The shared insert path covers
-- explicit invitations, group creation, Pick Again, and Hang-to-Pick.
alter table public.pick_participants add column joined_pick_state public.pick_state;
create function private.record_pick_join_state() returns trigger
language plpgsql set search_path = '' as $$
begin
  select p.state into new.joined_pick_state
  from public.picks p where p.id = new.pick_id for no key update;
  return new;
end;
$$;
revoke all on function private.record_pick_join_state() from public,anon,authenticated;
create trigger record_pick_join_state before insert on public.pick_participants
for each row execute function private.record_pick_join_state();

-- Track explicit plan edits before the notifier runs, so the sweep cannot send a
-- starting-soon alert between the schedule commit and the schedule notification.
alter table public.picks add column plan_time_changed_at timestamptz;
create function private.record_plan_time_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.plan_time_changed_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function private.record_plan_time_change() from public,anon,authenticated;
create trigger record_plan_time_change before update of plan_at on public.picks
for each row when (new.plan_at is distinct from old.plan_at
                   and new.plan_time_changes > old.plan_time_changes)
execute function private.record_plan_time_change();

-- Defer starting-soon selection during the cooldown without consuming its
-- once-per-Pick notification slot. Eligibility is rechecked before delivery.
create function public.pick_plan_targets_with_revision(p_now timestamptz)
returns table (pick_id uuid, kind text, user_ids uuid[], schedule_revision integer)
language sql
stable
set search_path = ''
as $$
  with due as (
    select p.id, 'plan_reminder'::text as kind, p.schedule_revision from public.picks p
    where p.state = 'completed' and p.plan_at > p_now and p.plan_at <= p_now + interval '1 hour'
      and (p.plan_time_changed_at is null or p.plan_time_changed_at <= p_now - interval '30 minutes')
    union all
    select p.id, 'did_you_go', p.schedule_revision from public.picks p
    where p.state = 'completed' and coalesce(p.plan_at, p.decided_at) > p_now - interval '14 days'
      and coalesce(p.plan_at + interval '3 hours', p.decided_at + interval '24 hours') <= p_now
      and p.decided_at >= (select launched_at from private.feature_launches where feature = 'did_you_go')
  )
  select d.id, d.kind, array_agg(pp.user_id order by pp.user_id), d.schedule_revision
  from due d
  join public.pick_participants pp on pp.pick_id = d.id
  where not exists (
      select 1 from public.pick_rsvps r
      where r.pick_id = d.id and r.user_id = pp.user_id and r.status = 'not_going')
    and not exists (
      select 1 from public.notifications n
      where n.pick_id = d.id and n.user_id = pp.user_id and n.type = d.kind)
    and (d.kind <> 'plan_reminder' or not exists (
      select 1 from public.notifications n
      where n.pick_id = d.id and n.user_id = pp.user_id and n.type = 'plan_time_set'
        and n.created_at > p_now - interval '30 minutes'))
    and (d.kind <> 'did_you_go' or not exists (
      select 1 from public.pick_outcomes o where o.pick_id = d.id and o.user_id = pp.user_id))
  group by d.id, d.kind, d.schedule_revision
  order by d.id, d.kind
  limit 200;
$$;

revoke all on function public.pick_plan_targets_with_revision(timestamptz) from public,anon,authenticated;
grant execute on function public.pick_plan_targets_with_revision(timestamptz) to service_role;

create or replace function public.pick_plan_targets(p_now timestamptz)
returns table (pick_id uuid, kind text, user_ids uuid[])
language sql stable set search_path = '' as $$
  select t.pick_id, t.kind, t.user_ids from public.pick_plan_targets_with_revision(p_now) t;
$$;

-- Keep one source of truth for inbox visibility and push eligibility. The service
-- reads it after the event write, and the owner-only SELECT policy applies it too.
create function private.notification_relevant(
  n public.notifications, p_push boolean, v_now timestamptz default statement_timestamp()
)
returns boolean language plpgsql stable set search_path = '' as $$
declare
  p public.picks;
  h public.hang_posts;
  participant public.pick_participants;
begin
  if (p_push and n.read_at is not null) or not exists (
    select 1 from public.profiles where id = n.user_id and not avatar_deletion_pending
  ) then return false; end if;

  case n.type
    when 'group_invite' then
      return exists (
        select 1 from public.group_invitations i
        join public.profiles inviter on inviter.id = i.inviter_id and not inviter.avatar_deletion_pending
        where i.id = private.try_uuid(n.payload->>'inviteId') and i.invitee_id = n.user_id
          and i.status = 'pending' and private.group_invitation_available(i)
          and not exists (select 1 from public.group_members m
                          where m.group_id = i.group_id and m.user_id = n.user_id)
      );
    when 'hang_invite' then
      select * into h from public.hang_posts where id = private.try_uuid(n.payload->>'hangId');
      return found and private.can_view_hang(h.id, n.user_id)
        and exists (select 1 from public.profiles where id = h.author_id and not avatar_deletion_pending)
        and not exists (select 1 from public.hang_responses r
                        where r.post_id = h.id and r.user_id = n.user_id);
    when 'group_message' then
      return exists (
        select 1 from public.group_messages m
        join public.group_members recipient on recipient.group_id = m.group_id and recipient.user_id = n.user_id
        join public.profiles sender on sender.id = m.sender_id and not sender.avatar_deletion_pending
        where m.id = n.group_message_id and m.sender_id <> n.user_id
          and not private.is_blocked_between(m.sender_id, n.user_id)
      );
    when 'direct_message' then
      return exists (
        select 1 from public.direct_messages m
        join public.direct_conversations c on c.id = m.conversation_id
        join public.profiles sender on sender.id = m.sender_id and not sender.avatar_deletion_pending
        where m.id = n.direct_message_id and n.user_id in (c.user_low, c.user_high)
          and n.user_id <> m.sender_id and private.are_friends(c.user_low, c.user_high)
          and not private.is_blocked_between(c.user_low, c.user_high)
      );
    else
      null;
  end case;

  select * into p from public.picks where id = n.pick_id;
  if not found then return false; end if;
  select * into participant from public.pick_participants where pick_id = p.id and user_id = n.user_id;
  if not found or (p.group_id is not null and not exists (
    select 1 from public.group_members m where m.group_id = p.group_id and m.user_id = n.user_id
  )) then return false; end if;

  if p.host_id is not null and (
    private.is_blocked_between(p.host_id, n.user_id) or not exists (
      select 1 from public.profiles where id = p.host_id and not avatar_deletion_pending
    )
  ) then return false; end if;

  case n.type
    when 'pick_canceled' then return p.state = 'canceled';
    when 'winner_decided' then return p.state = 'completed';
    when 'added_to_pick' then
      if not p_push then return p.state <> 'canceled'; end if;
      if n.payload->>'draftAddition' = 'true' then return false; end if;
    when 'vote_needed' then
      return p.state = 'final_vote' and p.vote_deadline_at > v_now
        and private.availability_voter(p.id, n.user_id)
        and not exists (select 1 from public.final_votes v where v.pick_id = p.id and v.user_id = n.user_id);
    when 'plan_time_set' then
      return p.state = 'completed' and p.plan_at > v_now
        and case when n.payload ? 'scheduleRevision'
          then n.payload->>'scheduleRevision' = p.schedule_revision::text
          else p.plan_time_changed_at is null or n.created_at >= p.plan_time_changed_at
        end
        and (not (n.payload ? 'timeSuggestionId') or exists (
          select 1 from public.pick_time_suggestions s
          where s.id = private.try_uuid(n.payload->>'timeSuggestionId')
            and s.pick_id = p.id and s.status = 'accepted' and s.base_revision + 1 = p.schedule_revision
        ))
        and not exists (select 1 from public.pick_rsvps r where r.pick_id = p.id and r.user_id = n.user_id
                        and r.updated_at >= coalesce(p.plan_time_changed_at, n.created_at))
        and not exists (select 1 from public.notifications newer
                        where newer.user_id = n.user_id and newer.pick_id = p.id
                          and newer.type = n.type and newer.created_at > n.created_at);
    when 'plan_reminder' then
      if n.payload ? 'scheduleRevision' and n.payload->'scheduleRevision' <> to_jsonb(p.schedule_revision)
        then return false; end if;
      return p.state = 'completed' and p.plan_at > v_now and p.plan_at <= v_now + interval '1 hour'
        and (p.plan_time_changed_at is null
             or n.created_at >= p.plan_time_changed_at + interval '30 minutes')
        and not exists (select 1 from public.pick_rsvps r where r.pick_id = p.id and r.user_id = n.user_id
                        and r.status = 'not_going')
        and not exists (select 1 from public.notifications recent
                        where recent.user_id = n.user_id and recent.pick_id = p.id
                          and recent.type = 'plan_time_set'
                          and recent.created_at > n.created_at - interval '30 minutes');
    when 'did_you_go' then
      if n.payload ? 'scheduleRevision' and n.payload->'scheduleRevision' <> to_jsonb(p.schedule_revision)
        then return false; end if;
      return p.state = 'completed'
        and coalesce(p.plan_at + interval '3 hours', p.decided_at + interval '24 hours') <= v_now
        and coalesce(p.plan_at, p.decided_at) > v_now - interval '14 days'
        and p.decided_at >= (select launched_at from private.feature_launches where feature = 'did_you_go')
        and not exists (select 1 from public.pick_outcomes o where o.pick_id = p.id and o.user_id = n.user_id)
        and not exists (select 1 from public.pick_rsvps r where r.pick_id = p.id and r.user_id = n.user_id
                        and r.status = 'not_going');
    when 'time_suggested' then
      return n.user_id = p.host_id and private.time_suggestion_access(p.id, n.user_id) and exists (
        select 1 from public.pick_time_suggestions s
        join public.profiles proposer on proposer.id = s.proposer_id and not proposer.avatar_deletion_pending
        where s.id = private.try_uuid(n.payload->>'timeSuggestionId') and s.pick_id = p.id
          and s.status = 'pending' and s.base_revision = p.schedule_revision and s.plan_at > v_now
          and private.time_suggestion_access(p.id, s.proposer_id)
      );
    else
      if n.type not in ('pick_started', 'reminder') then return false; end if;
  end case;

  return p.state = 'swiping' and (p.deadline_at is null or p.deadline_at > v_now)
    and participant.finished_at is null
    and (n.type <> 'reminder' or p.deadline_at <= v_now + interval '1 hour')
    and (p.proposed_at is null or not exists (
      select 1 from public.pick_availability a
      where a.pick_id = p.id and a.user_id = n.user_id and a.revision = p.availability_revision
        and a.response = 'cant'
    ));
end;
$$;

revoke all on function private.notification_relevant(public.notifications,boolean,timestamptz) from public,anon,authenticated;
grant execute on function private.notification_relevant(public.notifications,boolean,timestamptz) to service_role;

create function private.own_current_notification(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.notifications n
                 where n.id = p_id and n.user_id = (select auth.uid())
                   and private.notification_relevant(n, false));
$$;
revoke all on function private.own_current_notification(uuid) from public,anon;
grant execute on function private.own_current_notification(uuid) to authenticated;

alter policy "notifications: only my own" on public.notifications
  using (user_id = (select auth.uid()) and private.own_current_notification(id));

create function public.notification_feed(
  p_user uuid, p_limit integer, p_before timestamptz default null, p_before_id uuid default null
) returns setof public.notifications language sql stable set search_path = '' as $$
  select n.* from public.notifications n
  where n.user_id = p_user and (p_before is null or (n.created_at, n.id) < (p_before, p_before_id))
    and private.notification_relevant(n, false)
  order by n.created_at desc, n.id desc
  limit least(greatest(p_limit, 0), 51);
$$;

-- Direct time edits should notify once per recipient and schedule revision.
create unique index notifications_once_per_schedule_revision on public.notifications
  (user_id, pick_id, (payload->>'scheduleRevision'))
  where type = 'plan_time_set' and payload ? 'scheduleRevision';

-- Keep the existing writers and their uniqueness guards. The wrapper returns the
-- rows from this RPC transaction so each device can receive the owner's exact inbox ID.
create function public.notification_record(
  p_user_ids uuid[], p_type text, p_pick_id uuid, p_payload jsonb
) returns setof uuid language plpgsql set search_path = '' as $$
declare
  v_users uuid[];
  v_revision integer;
  v_candidate public.notifications;
  v_user uuid;
  v_now timestamptz;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
begin
  if p_type = 'added_to_pick' then
    return query insert into public.notifications as n (user_id, type, pick_id, payload)
      select pp.user_id, p_type, pp.pick_id, v_payload || jsonb_build_object(
        'draftAddition', pp.joined_pick_state is distinct from 'swiping'::public.pick_state
      )
      from public.pick_participants pp
      where pp.pick_id = p_pick_id and pp.user_id = any(p_user_ids)
      on conflict do nothing returning n.id;
    return;
  elsif p_type in ('plan_reminder', 'did_you_go') then
    select schedule_revision into v_revision from public.picks where id = p_pick_id for update;
    if not found or v_payload->'scheduleRevision' is distinct from to_jsonb(v_revision)
      then return; end if;

    v_now := clock_timestamp();
    v_candidate.type := p_type;
    v_candidate.pick_id := p_pick_id;
    v_candidate.payload := v_payload;
    v_candidate.created_at := v_now;
    for v_user in select distinct unnest(p_user_ids) loop
      v_candidate.user_id := v_user;
      if private.notification_relevant(v_candidate, true, v_now) then
        return query insert into public.notifications as n (user_id, type, pick_id, payload, created_at)
          values (v_user, p_type, p_pick_id, v_payload, v_now)
          on conflict do nothing returning n.id;
      end if;
    end loop;
    return;
  elsif p_type = 'plan_time_set' and not (v_payload ? 'timeSuggestionId') then
    select schedule_revision into v_revision
    from public.picks where id = p_pick_id and (
      not (v_payload ? 'planAt') or plan_at = (v_payload->>'planAt')::timestamptz
    );
    if not found then return; end if;
    v_payload := (v_payload - 'planAt') || jsonb_build_object('scheduleRevision', v_revision);
  end if;

  select array_agg(user_id) into v_users
  from public.notify_insert(p_user_ids, p_type, p_pick_id, v_payload) as inserted(user_id);
  return query
    select distinct on (n.user_id) n.id from public.notifications n
    where n.user_id = any(v_users) and n.type = p_type and n.pick_id is not distinct from p_pick_id
      and n.created_at = transaction_timestamp()
      and n.payload @> v_payload
    order by n.user_id, n.id desc;
end;
$$;

create function public.notification_revalidate(p_user uuid, p_ids uuid[])
returns setof public.notifications language sql stable set search_path = '' as $$
  select n.* from public.notifications n
  where n.user_id = p_user and n.id = any(p_ids) and private.notification_relevant(n, false);
$$;

create function public.notification_push_targets(
  p_ids uuid[], p_hang_id text default null, p_hang_users uuid[] default null
) returns table(notification_id uuid, token text, deadline timestamptz)
language sql stable set search_path = '' as $$
  select n.id, t.token, case
    when n.type = 'hang_invite' then h.expires_at
    when n.type = 'group_invite' then null
    when n.type = 'vote_needed' then p.vote_deadline_at
    when n.type in ('pick_started', 'reminder', 'added_to_pick') then p.deadline_at
    when n.type in ('plan_time_set', 'plan_reminder') then p.plan_at
    when n.type = 'time_suggested' then s.plan_at
    when n.type = 'did_you_go' then coalesce(p.plan_at, p.decided_at) + interval '14 days'
  end
  from public.notifications n
  join public.push_tokens t on t.user_id = n.user_id
  left join public.picks p on p.id = n.pick_id
  left join public.hang_posts h on n.type = 'hang_invite' and h.id = private.try_uuid(n.payload->>'hangId')
  left join public.pick_time_suggestions s on n.type = 'time_suggested'
    and s.id = private.try_uuid(n.payload->>'timeSuggestionId')
  where (n.id = any(p_ids) or (n.type = 'hang_invite'
         and n.payload->>'hangId' = p_hang_id and n.user_id = any(p_hang_users)))
    and private.notification_relevant(n, true);
$$;

revoke all on function public.notification_feed(uuid,integer,timestamptz,uuid),
  public.notification_revalidate(uuid,uuid[]),
  public.notification_record(uuid[],text,uuid,jsonb),
  public.notification_push_targets(uuid[],text,uuid[]) from public,anon,authenticated;
grant execute on function public.notification_feed(uuid,integer,timestamptz,uuid),
  public.notification_revalidate(uuid,uuid[]),
  public.notification_record(uuid[],text,uuid,jsonb),
  public.notification_push_targets(uuid[],text,uuid[]) to service_role;
