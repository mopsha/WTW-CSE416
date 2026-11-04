-- Report a single group or direct message (App Store guideline 1.2). A report keeps a copy of
-- the message, because the original can be deleted with its group or conversation. Reports stay
-- server-only: clients write through report_create and nobody reads them through the API.
alter table public.reports drop constraint reports_target_kind_check;
alter table public.reports add constraint reports_target_kind_check
  check (target_kind in ('user', 'pick', 'group', 'group_message', 'direct_message'));

alter table public.reports
  -- Deleting the reported person's account also deletes reports naming them and their words.
  add column reported_user_id uuid references public.profiles (id) on delete cascade,
  add column message_body text,
  add column reviewed_at timestamptz,
  add column review_note text,
  add constraint reports_message_snapshot_check check (
    (target_kind in ('group_message', 'direct_message')) = (message_body is not null)
    and (message_body is null or reported_user_id is not null)
  );
comment on column public.reports.message_body is 'Copy of the reported message at report time.';

update public.reports r
set reported_user_id = r.target_id
where r.target_kind = 'user'
  and exists (select 1 from public.profiles p where p.id = r.target_id);

create index reports_unreviewed_idx on public.reports (created_at) where reviewed_at is null;

-- You can report a message in a group you are in or a conversation you are part of, never your
-- own. Anything else is PT404, so a report never confirms that something exists. Grants survive
-- the replace.
create or replace function public.report_create(p_user_id uuid, p_kind text, p_target_id uuid, p_reason text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_visible boolean := false;
  v_reported uuid;
  v_body text;
  v_id uuid;
begin
  if p_kind is null
     or p_kind not in ('user', 'pick', 'group', 'group_message', 'direct_message')
     or p_target_id is null
     or char_length(v_reason) not between 1 and 500 then
    raise exception using errcode = 'PT400', message = 'Invalid report';
  end if;
  case p_kind
    when 'user' then
      v_visible := p_target_id <> p_user_id
        and exists (select 1 from public.profiles where id = p_target_id);
      if v_visible then v_reported := p_target_id; end if;
    when 'pick' then
      v_visible := exists (
        select 1 from public.pick_participants where pick_id = p_target_id and user_id = p_user_id);
    when 'group' then
      v_visible := exists (
        select 1 from public.group_members where group_id = p_target_id and user_id = p_user_id);
    when 'group_message' then
      select m.sender_id, m.body into v_reported, v_body
      from public.group_messages m
      join public.group_members gm on gm.group_id = m.group_id and gm.user_id = p_user_id
      where m.id = p_target_id and m.sender_id <> p_user_id;
      v_visible := found;
    when 'direct_message' then
      select m.sender_id, m.body into v_reported, v_body
      from public.direct_messages m
      join public.direct_conversations c on c.id = m.conversation_id
      where m.id = p_target_id and m.sender_id <> p_user_id
        and p_user_id in (c.user_low, c.user_high);
      v_visible := found;
  end case;
  if not v_visible then
    raise exception using errcode = 'PT404', message = 'Nothing to report here';
  end if;
  if not private.rate_take(p_user_id, 'report') then
    raise exception using errcode = 'PT429', message = 'Too many reports today';
  end if;
  insert into public.reports (reporter_id, target_kind, target_id, reason, reported_user_id, message_body)
  values (p_user_id, p_kind, p_target_id, v_reason, v_reported, v_body)
  returning id into v_id;
  return v_id;
end;
$$;

-- The team's queue, read from the Supabase SQL editor (docs/moderation.md). The private schema
-- is not exposed through the API.
create view private.report_queue as
select
  r.id,
  r.created_at,
  r.target_kind,
  r.target_id,
  r.reason,
  r.message_body,
  r.reported_user_id,
  reported.display_name as reported_name,
  r.reporter_id,
  reporter.display_name as reporter_name
from public.reports r
join public.profiles reporter on reporter.id = r.reporter_id
left join public.profiles reported on reported.id = r.reported_user_id
where r.reviewed_at is null
order by r.created_at;
revoke all on private.report_queue from public, anon, authenticated;
