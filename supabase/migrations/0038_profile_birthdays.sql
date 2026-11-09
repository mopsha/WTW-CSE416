-- Existing profiles are grandfathered. Only profiles created after this migration
-- require a birthday to finish account setup. Never backfill an invented date.
alter table public.profiles add column birthday_required boolean not null default false;
-- Keep the signup cohort after a date is supplied, so clearing it during setup
-- cannot bypass the requirement. Existing accounts remain exempt.
alter table public.profiles add column birthday_setup_required boolean not null default false;
alter table public.profiles alter column birthday_setup_required set default true;
alter table public.profiles alter column birthday_required set default true;

create table private.profile_birthdays (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 birth_month smallint not null check(birth_month between 1 and 12),
 birth_day smallint not null check(birth_day between 1 and case
  when birth_month=2 then 29 when birth_month in (4,6,9,11) then 30 else 31 end),
 share_birthday boolean not null default false
);
alter table private.profile_birthdays enable row level security;
revoke all on private.profile_birthdays from public,anon,authenticated;
grant select,insert,update,delete on private.profile_birthdays to service_role;
-- Only recurring month/day live outside the exposed schema. No year, date column,
-- auth metadata or client grants. 0038 is confirmed undeployed and updated in place.
comment on table private.profile_birthdays is 'Private recurring birthday month/day only. No birth year is collected or stored. Friend visibility is opt-in.';

create function private.write_profile_birthday(p_user_id uuid,p_input jsonb) returns void
language plpgsql set search_path='' as $$
declare m numeric; d numeric; sharing boolean; begin
 if p_input ?| array['birthDate','birthYear','year'] then
  raise exception using errcode='PT400',message='Birthday uses month and day only'; end if;
 if not (p_input ? 'birthday' or p_input ? 'shareBirthday') then return; end if;
 perform 1 from public.profiles where id=p_user_id and not avatar_deletion_pending for update;
 if not found then raise exception using errcode='PT404',message='Profile not found'; end if;
 select birth_month,birth_day,share_birthday into m,d,sharing from private.profile_birthdays where user_id=p_user_id;
 sharing:=coalesce(sharing,false);
 if p_input ? 'birthday' then
  if jsonb_typeof(p_input->'birthday')='null' then m:=null; d:=null;
  else
   if jsonb_typeof(p_input->'birthday') is distinct from 'object' then
    raise exception using errcode='PT400',message='Choose a birthday month and day'; end if;
   if (select count(*) from jsonb_object_keys(p_input->'birthday'))<>2
    or jsonb_typeof(p_input->'birthday'->'month') is distinct from 'number'
    or jsonb_typeof(p_input->'birthday'->'day') is distinct from 'number' then
    raise exception using errcode='PT400',message='Choose a birthday month and day'; end if;
   m:=(p_input->'birthday'->>'month')::numeric;
   d:=(p_input->'birthday'->>'day')::numeric;
   if m<>trunc(m) or d<>trunc(d) or m not between 1 and 12
    or d not between 1 and (case when m=2 then 29 when m in (4,6,9,11) then 30 else 31 end) then
    raise exception using errcode='PT400',message='Choose a valid birthday month and day'; end if;
  end if;
 end if;
 if p_input ? 'shareBirthday' then
  if jsonb_typeof(p_input->'shareBirthday') is distinct from 'boolean' then
   raise exception using errcode='PT400',message='Invalid birthday privacy preference'; end if;
  sharing:=(p_input->>'shareBirthday')::boolean;
 end if;
 if m is null then
  if sharing then raise exception using errcode='PT400',message='Add a birthday before sharing it'; end if;
  delete from private.profile_birthdays where user_id=p_user_id;
  update public.profiles set birthday_required=birthday_setup_required and optional_setup_pending where id=p_user_id;
 else
  insert into private.profile_birthdays(user_id,birth_month,birth_day,share_birthday) values(p_user_id,m::smallint,d::smallint,sharing)
   on conflict(user_id) do update set birth_month=excluded.birth_month,birth_day=excluded.birth_day,share_birthday=excluded.share_birthday;
  update public.profiles set birthday_required=false where id=p_user_id;
 end if;
end $$;
revoke all on function private.write_profile_birthday(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.write_profile_birthday(uuid,jsonb) to service_role;

-- Older clients cannot mark a new account's onboarding complete by skipping birthday.
create function private.require_birthday_for_setup() returns trigger
language plpgsql set search_path='' as $$ begin
 if new.birthday_setup_required and not exists(select 1 from private.profile_birthdays where user_id=new.id)
  and (not new.optional_setup_pending or new.preferences_updated_at is distinct from old.preferences_updated_at) then
  raise exception using errcode='PT400',message='Add your birthday to finish account setup'; end if;
 return new;
end $$;
revoke all on function private.require_birthday_for_setup() from public,anon,authenticated;
create trigger require_birthday_for_setup before update of optional_setup_pending,preferences_updated_at on public.profiles
 for each row execute function private.require_birthday_for_setup();

create or replace function public.user_profile_get(p_viewer_id uuid,p_target_id uuid) returns jsonb
language plpgsql stable set search_path='' as $$
declare p public.profiles; b private.profile_birthdays; own boolean:=p_viewer_id=p_target_id; visible boolean; friends bigint; groups bigint; mutual jsonb:='[]';
begin
 if p_viewer_id is null or p_target_id is null then raise exception using errcode='PT404',message='Profile not found'; end if;
 select * into p from public.profiles where id=p_target_id;
 if not found or p.avatar_deletion_pending or not exists(select 1 from public.profiles where id=p_viewer_id and not avatar_deletion_pending) or (not own and (not private.are_friends(p_viewer_id,p_target_id) or private.is_blocked_between(p_viewer_id,p_target_id))) then
  raise exception using errcode='PT404',message='Profile not found';
 end if;
 visible:=own or p.share_profile_metadata;
 if visible then
  select count(*) into friends from public.friendships f where f.status='accepted'
   and (f.requester_id=p_target_id or f.addressee_id=p_target_id)
   and not private.is_blocked_between(f.requester_id,f.addressee_id);
  select count(*) into groups from public.group_members where user_id=p_target_id;
  if not own then
   select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'name',g.name) order by g.name,g.id),'[]') into mutual
   from public.groups g join public.group_members a on a.group_id=g.id and a.user_id=p_viewer_id
    join public.group_members b on b.group_id=g.id and b.user_id=p_target_id;
  end if;
 end if;
 select * into b from private.profile_birthdays where user_id=p_target_id;
 return jsonb_build_object('id',p.id,'displayName',p.display_name,'username',p.username,'avatarUrl',p.avatar_url,
  'isOwner',own,'metadataVisible',visible,'friendsCount',friends,'groupsCount',groups,
  'favoriteCuisine',case when visible then p.favorite_cuisine end,
  'favoriteActivity',case when visible then p.favorite_activity end,'mutualGroups',mutual)
  ||case when own then jsonb_build_object('shareMetadata',p.share_profile_metadata,'birthday',case when b.user_id is not null then jsonb_build_object('month',b.birth_month,'day',b.birth_day) else 'null'::jsonb end,'shareBirthday',coalesce(b.share_birthday,false),'birthdayRequired',p.birthday_required) else case when b.share_birthday and b.user_id is not null then jsonb_build_object('birthday',jsonb_build_object('month',b.birth_month,'day',b.birth_day)) else '{}'::jsonb end end;
end $$;
-- Compose with 0031's existing required-username wrapper rather than replacing
-- its invariants with the earlier base implementation.
alter function public.user_profile_update(uuid,jsonb) rename to user_profile_update_before_birthdays;
alter function public.user_profile_update_before_birthdays(uuid,jsonb) set schema private;
create function public.user_profile_update(p_user_id uuid,p_input jsonb) returns jsonb
language plpgsql set search_path='' as $$ begin
 perform private.user_profile_update_before_birthdays(p_user_id,p_input);
 perform private.write_profile_birthday(p_user_id,p_input);
 return public.user_profile_get(p_user_id,p_user_id);
end $$;
revoke all on function public.user_profile_update(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.user_profile_update(uuid,jsonb) to service_role;

create or replace function public.user_identity_update(p_user_id uuid, p_input jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare n text := btrim(p_input->>'displayName'); u text := lower(btrim(p_input->>'username'));
begin
 if jsonb_typeof(p_input) is distinct from 'object'
  or jsonb_typeof(p_input->'displayName') is distinct from 'string'
  or jsonb_typeof(p_input->'username') is distinct from 'string'
  or n is null or char_length(n) not between 1 and 50 or n ~ '[[:cntrl:]]'
  or u is null or u !~ '^[a-z0-9_]{3,24}$' then
  raise exception using errcode='PT400',message='Invalid identity';
 end if;
 -- One write: a username conflict cannot leave a partially changed display name.
 -- Missing legacy profile rows can be repaired; they do not repeat new-account setup.
 insert into public.profiles(id,display_name,username,optional_setup_pending,birthday_required,birthday_setup_required)
 values(p_user_id,n,u,false,false,false)
 on conflict(id) do update set display_name=excluded.display_name,username=excluded.username,updated_at=now();
 perform private.write_profile_birthday(p_user_id,p_input);
 return public.user_profile_get(p_user_id,p_user_id);
end $$;
