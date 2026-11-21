begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(2);

insert into auth.users(id, email, raw_user_meta_data)
values
  ('55000000-0000-4000-8000-000000000001', 'hang55-host@example.test', '{"display_name":"Host"}'),
  ('55000000-0000-4000-8000-000000000002', 'hang55-down@example.test', '{"display_name":"Down"}'),
  ('55000000-0000-4000-8000-000000000003', 'hang55-maybe@example.test', '{"display_name":"Maybe"}'),
  ('55000000-0000-4000-8000-000000000004', 'hang55-cant@example.test', '{"display_name":"Cant"}'),
  ('55000000-0000-4000-8000-000000000005', 'hang55-outsider@example.test', '{"display_name":"Outsider"}');

update public.profiles set username = 'hang55_down'
where id = '55000000-0000-4000-8000-000000000002';
insert into public.friendships(requester_id, addressee_id, status, accepted_at)
values ('55000000-0000-4000-8000-000000000001', '55000000-0000-4000-8000-000000000002', 'accepted', now());

insert into public.groups(id, name, owner_id)
values ('55000000-0000-4000-8000-000000000010', 'Hang 55', '55000000-0000-4000-8000-000000000001');
insert into public.group_members(group_id, user_id, role)
select '55000000-0000-4000-8000-000000000010', id,
  case when id = '55000000-0000-4000-8000-000000000001' then 'owner' else 'member' end
from auth.users where id::text like '55000000-%' and id <> '55000000-0000-4000-8000-000000000005'
on conflict do nothing;

do $$
declare
  host constant uuid := '55000000-0000-4000-8000-000000000001';
  down constant uuid := '55000000-0000-4000-8000-000000000002';
  maybe constant uuid := '55000000-0000-4000-8000-000000000003';
  cant constant uuid := '55000000-0000-4000-8000-000000000004';
  outsider constant uuid := '55000000-0000-4000-8000-000000000005';
  grp constant uuid := '55000000-0000-4000-8000-000000000010';
  hang uuid;
  friend_hang uuid;
  pick uuid;
  result jsonb;
begin
  hang := (public.hang_create(host, jsonb_build_object(
    'activity', 'Lunch', 'audience', 'group', 'groupId', grp,
    'startsAt', now() + interval '1 hour', 'expiresAt', now() + interval '2 hours'
  ))->>'id')::uuid;
  perform public.hang_respond(hang, down, 'down');
  perform public.hang_respond(hang, maybe, 'maybe');
  perform public.hang_respond(hang, cant, 'cant');

  set local role service_role;
  if public.hang_get(hang, outsider) is not null then
    raise exception 'Outsider received a Hang projection';
  end if;

  result := public.hang_get(hang, host);
  if not coalesce(
    (result->>'canStartPick')::boolean and
    (result->>'downCount')::integer = 1 and (result->>'maybeCount')::integer = 1 and
    jsonb_array_length(result->'attendees') = 2 and
    result->'attendees' @> jsonb_build_array(
      jsonb_build_object('userId', down, 'status', 'down', 'username', 'hang55_down'),
      jsonb_build_object('userId', maybe, 'status', 'maybe', 'username', null)
    ), false
  ) then raise exception 'Host attendee projection is incorrect: %', result; end if;

  result := public.hang_get(hang, cant);
  if not coalesce(
    not (result->>'canStartPick')::boolean and
    result->'attendees' @> jsonb_build_array(jsonb_build_object('userId', down, 'username', null)),
    false
  ) then raise exception 'Nonfriend username or host action leaked: %', result; end if;

  if exists (
    select 1 from jsonb_array_elements(result->'attendees') attendee
    where attendee - array['userId', 'displayName', 'username', 'status'] <> '{}'::jsonb
  ) then raise exception 'Unexpected profile information in the attendee projection'; end if;
  pick := (public.hang_create_pick(hang, host,
    '{"category":"food","center":{"lat":40,"lng":-73},"radiusM":5000,"poolSize":5,"deadlineAt":null,"closeThreshold":100}'
  )->>'pickId')::uuid;
  if (public.hang_get(hang, host)->>'canStartPick')::boolean is distinct from true
    then raise exception 'The existing draft should be reusable'; end if;
  perform public.hang_respond(hang, maybe, 'down');
  if (public.hang_get(hang, host)->>'canStartPick')::boolean is distinct from false
    then raise exception 'An outdated draft should not be offered'; end if;
  perform public.hang_respond(hang, maybe, 'maybe');
  update public.picks set state = 'swiping' where id = pick;
  if (public.hang_get(hang, host)->>'canStartPick')::boolean is distinct from false
    then raise exception 'An active Pick should not show the start action'; end if;
  reset role;

  insert into public.blocks(blocker_id, blocked_id) values (down, cant);
  result := public.hang_get(hang, cant);
  if not coalesce((result->>'downCount')::integer = 0 and jsonb_array_length(result->'attendees') = 1, false)
    then raise exception 'Blocked attendee remained visible: %', result; end if;

  delete from public.group_members where group_id = grp and user_id = maybe;
  if public.hang_get(hang, maybe) is not null or
     (public.hang_get(hang, host)->>'maybeCount')::integer is distinct from 0
    then raise exception 'Removed member retained access or appeared as an attendee'; end if;

  perform public.hang_respond(hang, down, 'cant');
  if public.hang_get(hang, host)->'attendees' is distinct from '[]'::jsonb
    then raise exception 'Changing to Can’t left an attendee identity'; end if;

  friend_hang := (public.hang_create(host, jsonb_build_object(
    'activity', 'Dinner', 'audience', 'all_friends',
    'startsAt', now() + interval '1 hour', 'expiresAt', now() + interval '2 hours'
  ))->>'id')::uuid;
  perform public.hang_respond(friend_hang, down, 'down');
  delete from public.friendships where requester_id = host and addressee_id = down;
  if public.hang_get(friend_hang, down) is not null or
     public.hang_get(friend_hang, host)->'attendees' is distinct from '[]'::jsonb
    then raise exception 'Revoked friendship retained access or appeared as an attendee'; end if;

  update public.hang_posts set starts_at = now() - interval '2 hours', expires_at = now() - interval '1 hour'
  where id = hang;
  if public.hang_get(hang, host) is not null then raise exception 'Expired Hang was returned'; end if;
end $$;

select pass('Hang attendee projection enforces visibility and returns only Down and Maybe identities');
do $$
declare
  owner_id constant uuid := '55000000-0000-4000-8000-000000000001';
  author_id constant uuid := '55000000-0000-4000-8000-000000000005';
  down constant uuid := '55000000-0000-4000-8000-000000000002';
  maybe constant uuid := '55000000-0000-4000-8000-000000000003';
  cant constant uuid := '55000000-0000-4000-8000-000000000004';
  grp constant uuid := '55000000-0000-4000-8000-000000000010';
  hang uuid;
  result jsonb;
begin
  insert into public.group_members(group_id, user_id, role)
  values (grp, author_id, 'member'), (grp, maybe, 'member');

  insert into public.hang_posts(author_id, activity, audience, group_id, starts_at, expires_at, recipient_snapshot)
  values (author_id, 'Legacy group lunch', 'group', grp, now(), now() + interval '1 hour', false)
  returning id into hang;

  set local role service_role;
  perform public.hang_respond(hang, author_id, 'down');
  perform public.hang_respond(hang, down, 'down');
  perform public.hang_respond(hang, maybe, 'maybe');
  perform public.hang_respond(hang, cant, 'cant');
  result := public.hang_get(hang, author_id);
  if not coalesce(result @> '{"downCount":2,"maybeCount":1,"cantCount":1}'::jsonb
    and jsonb_array_length(result->'attendees') = 3, false)
  then raise exception 'Legacy group author could not see authorized RSVPs before removal: %', result; end if;
  reset role;

  delete from public.group_members where group_id = grp and user_id = author_id;
  set local role service_role;
  result := public.hang_get(hang, author_id);
  if not coalesce(result @> '{"activity":"Legacy group lunch","myStatus":"down","downCount":1,"maybeCount":0,"cantCount":0,"canStartPick":false}'::jsonb
    and jsonb_array_length(result->'attendees') = 1
    and (result->'attendees'->0->>'userId')::uuid = author_id, false)
  then raise exception 'Removed author lost the card or retained other responses: %', result; end if;

  result := public.hang_get(hang, owner_id);
  if not coalesce(result @> '{"downCount":1,"maybeCount":1,"cantCount":1}'::jsonb
    and jsonb_array_length(result->'attendees') = 2
    and result->'attendees' @> jsonb_build_array(
      jsonb_build_object('userId', down, 'status', 'down'),
      jsonb_build_object('userId', maybe, 'status', 'maybe')
    ), false)
  then raise exception 'Current member projection is incorrect after author removal: %', result; end if;
  reset role;

  insert into public.group_members(group_id, user_id, role) values (grp, author_id, 'member');
  set local role service_role;
  result := public.hang_get(hang, author_id);
  if not coalesce(result @> '{"downCount":2,"maybeCount":1,"cantCount":1}'::jsonb
    and jsonb_array_length(result->'attendees') = 3, false)
  then raise exception 'Rejoining did not restore active legacy group attendance: %', result; end if;
  reset role;
end $$;

select pass('Legacy group attendee identities and counts follow current source-group membership');
select * from finish();
rollback;
