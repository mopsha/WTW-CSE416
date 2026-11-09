-- Bounded home summaries. Returning the base table preserves PostgREST FK embedding.
-- Invoker security retains the same table grants/RLS as direct participant reads.
create function public.my_pick_summaries(
  p_history boolean,
  p_before_time timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 100
) returns setof public.picks
language plpgsql stable security invoker set search_path = ''
as $$
begin
  if p_history is null or p_limit is null or p_limit < 1 or p_limit > 100
     or (p_before_time is null) <> (p_before_id is null) then
    raise exception using errcode = '22023', message = 'Invalid summary page';
  end if;
  return query
    select p.* from public.picks p
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
revoke all on function public.my_pick_summaries(boolean,timestamptz,uuid,integer) from public, anon;
grant execute on function public.my_pick_summaries(boolean,timestamptz,uuid,integer) to authenticated;
create index picks_terminal_summary_order_idx
  on public.picks ((coalesce(decided_at,created_at)) desc,id)
  where state in ('completed','canceled');
