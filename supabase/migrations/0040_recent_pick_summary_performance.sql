-- 0039 remains unchanged. Keep the public RPC SECURITY INVOKER and apply RLS
-- to every returned Pick and embedded candidate. Only page-ID selection uses
-- a bounded definer helper, like the existing private membership RLS helpers.
-- Its caller is always auth.uid(); no caller-supplied identity or dynamic SQL.
create function private.my_pick_summary_ids(
  p_history boolean,
  p_before_time timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 100
) returns table (id uuid)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_history is null or p_limit is null or p_limit < 1 or p_limit > 100
     or (p_before_time is null) <> (p_before_id is null) then
    raise exception using errcode = '22023', message = 'Invalid summary page';
  end if;
  return query
    select p.id from public.picks p
    join public.pick_participants me on me.pick_id = p.id and me.user_id = auth.uid()
    where (case when p_history then p.state in ('completed', 'canceled')
                else p.state in ('draft', 'swiping', 'ranking', 'final_vote') end)
      and (p_before_time is null
        or coalesce(p.decided_at, p.created_at) < p_before_time
        or (coalesce(p.decided_at, p.created_at) = p_before_time and p.id > p_before_id))
    order by coalesce(p.decided_at, p.created_at) desc, p.id asc
    limit p_limit;
end;
$$;

alter function private.my_pick_summary_ids(boolean,timestamptz,uuid,integer) owner to postgres;
revoke all on function private.my_pick_summary_ids(boolean,timestamptz,uuid,integer) from public,anon;
grant execute on function private.my_pick_summary_ids(boolean,timestamptz,uuid,integer) to authenticated;
create or replace function public.my_pick_summaries(
  p_history boolean, p_before_time timestamptz default null,
  p_before_id uuid default null, p_limit integer default 100
) returns setof public.picks
language sql stable security invoker set search_path=''
begin atomic
  with selected as materialized (
    select ids.id from private.my_pick_summary_ids(p_history,p_before_time,p_before_id,p_limit) ids
  )
  -- OFFSET 0 keeps point lookups correlated: RLS must run for the selected
  -- page, not for every historical Pick before a hash join/sort.
  -- Return the named composite so future Pick columns do not freeze a p.* list.
  select visible.pick from selected
  join lateral (
    select p as pick from public.picks p where p.id=selected.id offset 0
  ) visible on true
  order by coalesce((visible.pick).decided_at,(visible.pick).created_at) desc,
           (visible.pick).id asc;
end;
revoke all on function public.my_pick_summaries(boolean,timestamptz,uuid,integer) from public,anon;
grant execute on function public.my_pick_summaries(boolean,timestamptz,uuid,integer) to authenticated;
