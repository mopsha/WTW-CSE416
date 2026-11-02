-- Unscheduled group library. Legacy picks.custom_options are private Pick snapshots,
-- not group-owned library entries: deliberately do not copy them or change the deck.
create table public.group_ideas (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  name text not null check (name = btrim(name) and char_length(name) between 1 and 60),
  category text not null check (category in ('activity', 'food')),
  description text check (char_length(description) <= 200),
  location_text text check (char_length(location_text) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index group_ideas_group_created on public.group_ideas(group_id, created_at desc, id);
alter table public.group_ideas enable row level security;
revoke all on public.group_ideas from anon, authenticated;
grant select on public.group_ideas to authenticated;
grant all on public.group_ideas to service_role;
create policy group_ideas_members_read on public.group_ideas for select to authenticated
  using (private.is_group_member(group_id));

-- All API reads/writes recheck membership despite the service-role RLS bypass.
-- Same group lock as membership mutations prevents writes racing removal/deletion.
create function public.group_ideas(
  p_action text, p_user_id uuid, p_group_id uuid,
  p_idea_id uuid default null, p_input jsonb default '{}'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  g public.groups;
  i public.group_ideas;
  result jsonb;
begin
  g := private.lock_group_as_member(p_group_id, p_user_id);
  if p_action = 'list' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc, x.id), '[]'::jsonb)
      into result from public.group_ideas x where x.group_id = p_group_id;
    return result;
  end if;
  if p_action not in ('get', 'create', 'update', 'delete') or p_action is null then
    raise exception using errcode = 'PT400', message = 'Invalid action';
  end if;
  if p_action <> 'create' then
    select * into i from public.group_ideas where id = p_idea_id and group_id = p_group_id for update;
    if not found then raise exception using errcode = 'PT404', message = 'Idea not found'; end if;
    if p_action = 'get' then return to_jsonb(i); end if;
    if i.created_by <> p_user_id and (p_action <> 'delete' or g.owner_id <> p_user_id) then
      raise exception using errcode = 'PT403', message = 'Not allowed';
    end if;
    if p_action = 'delete' then
      delete from public.group_ideas where id = i.id;
      return '{"status":"ok"}'::jsonb;
    end if;
  end if;
  if jsonb_typeof(p_input) is distinct from 'object'
    or jsonb_typeof(p_input->'name') is distinct from 'string'
    or jsonb_typeof(p_input->'category') is distinct from 'string'
    or (p_input ? 'description' and jsonb_typeof(p_input->'description') not in ('string', 'null'))
    or (p_input ? 'locationText' and jsonb_typeof(p_input->'locationText') not in ('string', 'null')) then
    raise exception using errcode = 'PT400', message = 'Invalid idea';
  end if;
  if p_action = 'create' then
    insert into public.group_ideas(group_id, created_by, name, category, description, location_text)
    values (p_group_id, p_user_id, btrim(p_input->>'name'), p_input->>'category',
      nullif(btrim(p_input->>'description'), ''), nullif(btrim(p_input->>'locationText'), '')) returning * into i;
  else
    update public.group_ideas set name = btrim(p_input->>'name'), category = p_input->>'category',
      description = nullif(btrim(p_input->>'description'), ''),
      location_text = nullif(btrim(p_input->>'locationText'), ''), updated_at = clock_timestamp()
      where id = i.id returning * into i;
  end if;
  return to_jsonb(i);
end;
$$;
revoke all on function public.group_ideas(text, uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.group_ideas(text, uuid, uuid, uuid, jsonb) to service_role;
