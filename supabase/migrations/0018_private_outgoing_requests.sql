-- Friend requests must not reveal who has an account (Mike, M4). POST /friends/requests answers
-- the same for any email, but 0008 then let the sender see a pending row and the person's name,
-- which only exist when the email is real. Until they accept, a request is visible only to the
-- person it was sent to: the sender sees nothing through RLS, profiles or friend_list.
drop policy "friendships: the two people in it" on public.friendships;
create policy "friendships: mine once accepted, or sent to me" on public.friendships
  for select to authenticated
  using (
    addressee_id = (select auth.uid())
    or (requester_id = (select auth.uid()) and status = 'accepted')
  );

create or replace function private.has_friendship_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.friendships
    where (addressee_id = (select auth.uid()) and requester_id = p_user_id)
       or (requester_id = (select auth.uid()) and addressee_id = p_user_id and status = 'accepted')
  );
$$;

create or replace function public.friend_list(p_user_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(item order by sort_at desc), '[]'::jsonb)
  from (
    select
      jsonb_build_object(
        'userId', p.id,
        'displayName', p.display_name,
        'status', f.status,
        'direction', case when f.requester_id = p_user_id then 'out' else 'in' end,
        'createdAt', f.created_at,
        'acceptedAt', f.accepted_at
      ) as item,
      coalesce(f.accepted_at, f.created_at) as sort_at
    from public.friendships f
    join public.profiles p
      on p.id = case when f.requester_id = p_user_id then f.addressee_id else f.requester_id end
    where f.addressee_id = p_user_id or (f.requester_id = p_user_id and f.status = 'accepted')
  ) friends;
$$;
