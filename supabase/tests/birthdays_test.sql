begin;
select '1..11';
-- The migration harness also verifies an actual pre-migration profile remains exempt.
insert into auth.users(id,email,raw_user_meta_data) values
 ('b0380001-3333-4333-8333-333333333333','birthday-owner@example.invalid','{}'),
 ('b0380002-3333-4333-8333-333333333333','birthday-friend@example.invalid','{}'),
 ('b0380003-3333-4333-8333-333333333333','birthday-stranger@example.invalid','{}');
set local role service_role;
do $$ begin
 if (select birthday_required from public.profiles where id='b0380001-3333-4333-8333-333333333333') then raise exception 'Birthday required'; end if;
 perform public.user_identity_update('b0380001-3333-4333-8333-333333333333','{"displayName":"Owner","username":"birthday_owner"}');
 update public.profiles set optional_setup_pending=false where id='b0380001-3333-4333-8333-333333333333';
 update public.profiles set preferences_updated_at=now() where id='b0380001-3333-4333-8333-333333333333';
end $$;
select 'ok 1 - new accounts can skip birthday and save setup and preferences';
do $$ declare d jsonb; begin
 foreach d in array array['{"month":2,"day":30}','{"month":4,"day":31}','{"month":0,"day":1}','{"month":1,"day":0}','{"month":13,"day":1}','{"month":2.5,"day":2}','{"month":2,"day":29,"year":2000}','{"month":"2","day":29}','{"month":2}','"2000-02-29"']::jsonb[] loop
  begin perform public.user_identity_update('b0380001-3333-4333-8333-333333333333',jsonb_build_object('displayName','Must rollback','username','birthday_owner','birthday',d)); raise exception 'Invalid birthday accepted'; exception when sqlstate 'PT400' then null; end;
 end loop;
 if (select display_name from public.profiles where id='b0380001-3333-4333-8333-333333333333')<>'Owner' then raise exception 'Identity partially saved'; end if;
end $$;
select 'ok 2 - invalid month/day and year-bearing requests roll back the entire identity write';
do $$ declare p jsonb; begin
 p:=public.user_identity_update('b0380001-3333-4333-8333-333333333333','{"displayName":"Owner","username":"birthday_owner","birthday":{"month":2,"day":29}}');
 if p->'birthday'<>'{"month":2,"day":29}'::jsonb or p->>'shareBirthday'<>'false' or p->>'birthdayRequired'<>'false' then raise exception 'Wrong owner birthday/default'; end if;
 perform public.user_profile_update('b0380001-3333-4333-8333-333333333333','{"username":"birthday_owner","shareMetadata":false,"birthday":null,"shareBirthday":false}');
 update public.profiles set optional_setup_pending=false,preferences_updated_at=now() where id='b0380001-3333-4333-8333-333333333333';
 if exists(select 1 from private.profile_birthdays where user_id='b0380001-3333-4333-8333-333333333333') then raise exception 'Removal not persisted'; end if;
 perform public.user_profile_update('b0380001-3333-4333-8333-333333333333','{"username":"birthday_owner","shareMetadata":false}');
 perform public.user_identity_update('b0380001-3333-4333-8333-333333333333','{"displayName":"Owner","username":"birthday_owner","birthday":{"month":2,"day":29}}');
 update public.profiles set optional_setup_pending=false where id='b0380001-3333-4333-8333-333333333333';
 insert into public.friendships(requester_id,addressee_id,status,accepted_at) values('b0380001-3333-4333-8333-333333333333','b0380002-3333-4333-8333-333333333333','accepted',now());
 if public.user_profile_get('b0380002-3333-4333-8333-333333333333','b0380001-3333-4333-8333-333333333333') ?| array['birthDate','shareBirthday','birthday','birthdayRequired'] then raise exception 'Default privacy leaked'; end if;
end $$;
select 'ok 3 - February 29 persists privately without any year, sharing defaults off';
do $$ declare p jsonb; begin
 p:=public.user_profile_update('b0380001-3333-4333-8333-333333333333','{"username":"birthday_owner","shareMetadata":false,"shareBirthday":true}');
 p:=public.user_profile_get('b0380002-3333-4333-8333-333333333333','b0380001-3333-4333-8333-333333333333');
 if p->'birthday'<>'{"month":2,"day":29}'::jsonb or p ?| array['birthDate','shareBirthday','birthdayRequired'] or p::text like '%2000%' then raise exception 'Unsafe friend projection'; end if;
 if p->>'metadataVisible'<>'false' then raise exception 'Birthday enabled metadata'; end if;
 perform public.user_profile_update('b0380001-3333-4333-8333-333333333333','{"username":"birthday_owner","shareMetadata":false,"birthday":null,"shareBirthday":false}');
 if public.user_profile_get('b0380002-3333-4333-8333-333333333333','b0380001-3333-4333-8333-333333333333') ? 'birthday' then raise exception 'Removed birthday visible'; end if;
 perform public.user_profile_update('b0380001-3333-4333-8333-333333333333','{"username":"birthday_owner","shareMetadata":false,"birthday":{"month":2,"day":29},"shareBirthday":true}');

 begin perform public.user_profile_get('b0380003-3333-4333-8333-333333333333','b0380001-3333-4333-8333-333333333333'); raise exception 'Stranger saw birthday'; exception when sqlstate 'PT404' then null; end;
 if public.person_lookup('b0380002-3333-4333-8333-333333333333','b0380001-3333-4333-8333-333333333333') ?| array['birthDate','birthday','shareBirthday'] then raise exception 'Identity lookup leaked birthday'; end if;
 if (public.username_search('b0380002-3333-4333-8333-333333333333','birthday_owner')->0) ?| array['birthDate','birthday','shareBirthday'] then raise exception 'Search leaked birthday'; end if;
end $$;
select 'ok 4 - only opted-in month/day goes to accepted friends, independently from metadata sharing';
do $$ begin
 perform public.block_user('b0380001-3333-4333-8333-333333333333','b0380002-3333-4333-8333-333333333333');
 begin perform public.user_profile_get('b0380002-3333-4333-8333-333333333333','b0380001-3333-4333-8333-333333333333'); raise exception 'Block leaked birthday'; exception when sqlstate 'PT404' then null; end;
 begin perform public.user_profile_get('b0380001-3333-4333-8333-333333333333','b0380002-3333-4333-8333-333333333333'); raise exception 'Reverse block leaked birthday'; exception when sqlstate 'PT404' then null; end;
 perform public.unblock_user('b0380001-3333-4333-8333-333333333333','b0380002-3333-4333-8333-333333333333');
 begin perform public.user_profile_get('b0380002-3333-4333-8333-333333333333','b0380001-3333-4333-8333-333333333333'); raise exception 'Removed friendship restored'; exception when sqlstate 'PT404' then null; end;
end $$;
select 'ok 5 - either-direction blocks and removed friendships revoke access';
do $$ declare p jsonb; begin
 p:=public.user_profile_update('b0380001-3333-4333-8333-333333333333','{"username":"birthday_owner","shareMetadata":false,"birthday":{"month":12,"day":31},"shareBirthday":false}');
 if p->'birthday'<>'{"month":12,"day":31}'::jsonb or p->>'shareBirthday'<>'false' then raise exception 'Edit not persisted'; end if;
 p:=public.user_profile_update('b0380001-3333-4333-8333-333333333333','{"username":"birthday_owner","shareMetadata":true}');
 if p->'birthday'<>'{"month":12,"day":31}'::jsonb then raise exception 'Legacy details erased birthday'; end if;
 update public.profiles set avatar_deletion_pending=true where id='b0380001-3333-4333-8333-333333333333';
 begin perform public.user_profile_get('b0380001-3333-4333-8333-333333333333','b0380001-3333-4333-8333-333333333333'); raise exception 'Deleting account exposed date'; exception when sqlstate 'PT404' then null; end;
end $$;
select 'ok 6 - edits persist, legacy updates preserve birthday, deletion-pending profiles fail closed';
reset role;
do $$ begin
 if has_table_privilege('authenticated','private.profile_birthdays','SELECT') or has_table_privilege('anon','private.profile_birthdays','SELECT')
  or has_column_privilege('authenticated','public.profiles','birthday_required','UPDATE')
  or has_column_privilege('authenticated','public.profiles','birthday_required','SELECT')
  or has_function_privilege('authenticated','private.write_profile_birthday(uuid,jsonb)','EXECUTE')
  or has_function_privilege('anon','public.user_profile_get(uuid,uuid)','EXECUTE') then raise exception 'Unsafe grants'; end if;
end $$;
set local role authenticated;
do $$ begin
 begin perform birth_month from private.profile_birthdays; raise exception 'Direct birthday read'; exception when insufficient_privilege then null; end;
 begin perform public.user_profile_get('b0380001-3333-4333-8333-333333333333','b0380001-3333-4333-8333-333333333333'); raise exception 'Spoofed viewer'; exception when insufficient_privilege then null; end;
end $$;
select 'ok 7 - anonymous/authenticated callers cannot read raw birthdays or spoof RPC viewers';
reset role;
delete from auth.users where id='b0380001-3333-4333-8333-333333333333';
do $$ begin if exists(select 1 from private.profile_birthdays where user_id='b0380001-3333-4333-8333-333333333333') then raise exception 'Birthday retained after account deletion'; end if; end $$;
select 'ok 8 - auth account deletion cascades to private birthday storage';
set local role service_role;
do $$ begin
 begin perform public.user_profile_update('b0380003-3333-4333-8333-333333333333','{"username":"birthday_stranger","shareMetadata":false,"shareBirthday":true}'); raise exception 'Shared absent date'; exception when sqlstate 'PT400' then null; end;
 if (select username from public.profiles where id='b0380003-3333-4333-8333-333333333333') is not null then raise exception 'Privacy failure partially saved'; end if;
end $$;
select 'ok 9 - invalid birthday privacy rolls back profile edits';
reset role;
do $$ begin
 if (select count(*) from information_schema.columns where table_schema='private' and table_name='profile_birthdays')<>4
  or exists(select 1 from information_schema.columns where table_schema='private' and table_name='profile_birthdays' and (column_name not in ('user_id','birth_month','birth_day','share_birthday') or data_type in ('date','timestamp with time zone','timestamp without time zone'))) then raise exception 'Birthday schema retains a year/date field'; end if;
end $$;
select 'ok 10 - private storage has only user ID, constrained month/day integers and sharing';
set local role service_role;
do $$ begin
 insert into private.profile_birthdays(user_id,birth_month,birth_day) values('b0380003-3333-4333-8333-333333333333',2,29);
 begin update private.profile_birthdays set birth_month=4,birth_day=31 where user_id='b0380003-3333-4333-8333-333333333333'; raise exception 'Invalid raw storage'; exception when check_violation then null; end;
 begin update private.profile_birthdays set birth_month=2,birth_day=30 where user_id='b0380003-3333-4333-8333-333333333333'; raise exception 'Invalid raw February'; exception when check_violation then null; end;
 begin perform public.user_identity_update('b0380003-3333-4333-8333-333333333333','{"displayName":"Stranger","username":"birthday_stranger","birthDate":"2000-02-29"}'); raise exception 'Legacy date accepted'; exception when sqlstate 'PT400' then null; end;
end $$;
select 'ok 11 - raw table constraints enforce valid month/day and APIs reject legacy dates';
rollback;
