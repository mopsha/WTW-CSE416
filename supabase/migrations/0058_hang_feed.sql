create or replace function public.hang_list(p_user uuid) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(
    jsonb_agg_strict(private.hang_json(h.id, p_user) order by h.starts_at, h.id),
    '[]'::jsonb
  )
  from (
    select post.id, post.starts_at
    from public.hang_posts post
    -- Match the profile availability checks in hang_json before taking the first 20.
    join public.profiles author on author.id = post.author_id and not author.avatar_deletion_pending
    join public.profiles viewer on viewer.id = p_user and not viewer.avatar_deletion_pending
    -- Restrict the candidate scan using hang_posts_active_idx.
    where post.expires_at > now()
      and private.can_view_hang(post.id, p_user)
    order by post.starts_at, post.id
    limit 20
  ) h;
$$;
