-- Josh M4 Phase 2 scaffolding. No friendship/group schema exists in this branch.
-- Fail closed: own active posts only until Razin supplies graph-backed RLS/RPCs.
create table public.hang_posts (
 id uuid primary key default gen_random_uuid(),
 author_id uuid not null references public.profiles(id) on delete cascade,
 starts_at timestamptz not null,
 expires_at timestamptz not null check (expires_at > starts_at and expires_at <= starts_at + interval '24 hours'),
 activity text not null check (length(trim(activity)) between 1 and 60),
 audience text not null check (audience in ('all_friends', 'group')),
 group_id uuid,
 check ((audience = 'group' and group_id is not null) or (audience = 'all_friends' and group_id is null))
);
comment on column public.hang_posts.group_id is 'Group FK/visibility deferred: Razin group tables are absent. API rejects group creation until membership helper is supplied.';
create index hang_posts_active_idx on public.hang_posts(expires_at, author_id);
create table public.hang_responses (
 post_id uuid not null references public.hang_posts(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 status text not null check (status in ('down', 'maybe', 'cant')),
 primary key(post_id, user_id)
);
alter table public.hang_posts enable row level security;
alter table public.hang_responses enable row level security;
revoke all on public.hang_posts, public.hang_responses from public, anon, authenticated;
grant select on public.hang_posts, public.hang_responses to authenticated;
grant all on public.hang_posts, public.hang_responses to service_role;
create policy "hang: own active only until graph integration" on public.hang_posts for select to authenticated
 using (author_id = auth.uid() and expires_at > now());
create policy "hang responses: author active only until graph integration" on public.hang_responses for select to authenticated
 using (exists (select 1 from public.hang_posts h where h.id = post_id and h.author_id = auth.uid() and h.expires_at > now()));
