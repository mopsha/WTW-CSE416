-- Add attendee identities to the existing authorized Hang projection. The raw
-- hang_responses policies, Hang mutations and invitation fanout are unchanged.
create or replace function private.hang_json(p_id uuid, p_user uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', h.id, 'authorId', h.author_id, 'authorName', author.display_name,
    'activity', h.activity, 'startsAt', h.starts_at, 'expiresAt', h.expires_at,
    'audience', h.audience, 'groupId', h.group_id, 'pickId', h.pick_id,
    'myStatus', responses.mine, 'downCount', responses.down, 'maybeCount', responses.maybe,
    'cantCount', responses.cant, 'attendees', responses.attendees,
    'viewer', jsonb_build_object(
      'userId', viewer.id, 'displayName', viewer.display_name, 'username', viewer.username
    ),
    'canStartPick', case
      when h.author_id <> p_user or responses.down = 0 then false
      when h.audience = 'group' and not exists (
        select 1 from public.group_members m where m.group_id = h.group_id and m.user_id = p_user
      ) then false
      when linked.state is not null and linked.state not in ('draft', 'completed', 'canceled')
        then false
      else cardinality(roster.ids) <= private.pick_participant_cap()
        and (linked.state is distinct from 'draft' or roster.ids = array(
          select pp.user_id from public.pick_participants pp where pp.pick_id = linked.id
          order by pp.user_id
        ))
    end
  )
  from public.hang_posts h
  join public.profiles author on author.id = h.author_id and not author.avatar_deletion_pending
  join public.profiles viewer on viewer.id = p_user and not viewer.avatar_deletion_pending
  left join public.picks linked on linked.id = h.pick_id
  cross join lateral (
    select max(r.status) filter (where r.user_id = p_user) as mine,
      count(*) filter (where r.status = 'down') as down,
      array_agg(p.id order by p.id) filter (where r.status = 'down' and h.author_id = p_user) as down_ids,
      count(*) filter (where r.status = 'maybe') as maybe,
      count(*) filter (where r.status = 'cant') as cant,
      coalesce(jsonb_agg(jsonb_build_object(
        'userId', p.id, 'displayName', p.display_name, 'status', r.status,
        'username', case when p.id = p_user or private.are_friends(p_user, p.id)
                     then p.username end
      ) order by p.display_name, p.id) filter (where r.status in ('down', 'maybe')), '[]') as attendees
    from public.hang_responses r
    join public.profiles p on p.id = r.user_id and not p.avatar_deletion_pending
    where r.post_id = h.id and private.can_view_hang(h.id, r.user_id)
      and not private.is_blocked_between(p_user, r.user_id)
      -- The legacy author exception grants access to the card and their own RSVP.
      -- Use the same row filter for identities and counts to avoid leaking responses.
      and (h.recipient_snapshot or h.audience <> 'group' or r.user_id = p_user or (
        exists (select 1 from public.group_members m
                where m.group_id = h.group_id and m.user_id = p_user)
        and exists (select 1 from public.group_members m
                    where m.group_id = h.group_id and m.user_id = r.user_id)
      ))
  ) responses
  cross join lateral (
    -- Match hang_create_pick's delegated host and block filtering for menu eligibility.
    select array(
      select id from unnest(responses.down_ids) id
      where not private.is_blocked_between(
        case when h.author_id = any(responses.down_ids) then h.author_id else responses.down_ids[1] end,
        id
      )
      order by id
    ) as ids
  ) roster
  where h.id = p_id and private.can_view_hang(h.id, p_user)
$$;
