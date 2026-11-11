-- Standalone assertions; rollback leaves existing accounts untouched.
begin;
select '1..8';
insert into auth.users(id,raw_user_meta_data) values
 ('d0000001-2222-4222-8222-222222222222','{"display_name":"Original"}'),
 ('d0000002-2222-4222-8222-222222222222','{"display_name":"Other"}');
do $$ begin
 if not (select optional_setup_pending from public.profiles where id='d0000001-2222-4222-8222-222222222222') then raise exception 'New account not offered setup'; end if;
end $$;
select 'ok 1 - newly created profiles receive optional setup offer';
set local role service_role;
do $$ declare p jsonb; begin
 p:=public.user_identity_update('d0000001-2222-4222-8222-222222222222','{"displayName":" Josh ","username":"JOSH_AUTH","birthday":{"month":2,"day":29}}');
 if p->>'displayName'<>'Josh' or p->>'username'<>'josh_auth' then raise exception 'Identity not normalized'; end if;
end $$;
select 'ok 2 - existing identity columns updated together and normalized';
do $$ begin
 begin perform public.user_identity_update('d0000002-2222-4222-8222-222222222222','{"displayName":"Changed","username":"JOSH_AUTH"}'); raise exception 'Duplicate accepted'; exception when unique_violation then null; end;
 if (select display_name from public.profiles where id='d0000002-2222-4222-8222-222222222222')<>'Other' then raise exception 'Partial identity write'; end if;
end $$;
select 'ok 3 - username conflict rolls back display-name change';
do $$ declare v jsonb; begin
 foreach v in array array['{"displayName":"Josh"}','{"displayName":"","username":"josh"}','{"displayName":"Josh","username":"bad name"}','{"displayName":{},"username":"josh"}']::jsonb[] loop
 begin perform public.user_identity_update('d0000001-2222-4222-8222-222222222222',v); raise exception 'Invalid identity accepted'; exception when sqlstate 'PT400' then null; end;
 end loop;
end $$;
select 'ok 4 - both required fields validated by database';
select public.user_profile_update('d0000001-2222-4222-8222-222222222222','{"username":"josh_auth","favoriteCuisine":"Japanese","favoriteActivity":"Basketball","shareMetadata":true}');
select public.user_identity_update('d0000001-2222-4222-8222-222222222222','{"displayName":"Josh New","username":"josh_auth"}');
do $$ begin
 if not exists(select 1 from public.profiles where id='d0000001-2222-4222-8222-222222222222' and favorite_cuisine='Japanese' and favorite_activity='Basketball' and share_profile_metadata and optional_setup_pending) then raise exception 'Metadata overwritten'; end if;
end $$;
select 'ok 5 - identity update preserves preferences, privacy and optional state';
update public.profiles set optional_setup_pending=false where id='d0000001-2222-4222-8222-222222222222';
update public.profiles set optional_setup_pending=false where id='d0000001-2222-4222-8222-222222222222';
do $$ begin
 if (select username from public.profiles where id='d0000001-2222-4222-8222-222222222222')<>'josh_auth' then raise exception 'Dismissal changed identity'; end if;
end $$;
select 'ok 6 - repeat dismissal leaves identity intact';
reset role;
set local role authenticated;
do $$ begin
 begin perform public.user_identity_update('d0000001-2222-4222-8222-222222222222','{"displayName":"Intruder","username":"intruder"}'); raise exception 'Client invoked service RPC'; exception when insufficient_privilege then null; end;
 begin perform optional_setup_pending from public.profiles; raise exception 'Private column exposed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'ok 7 - clients cannot impersonate callers or read private setup state';
insert into auth.users(id) values('d0000003-2222-4222-8222-222222222222');
delete from public.profiles where id='d0000003-2222-4222-8222-222222222222';
set local role service_role;
select public.user_identity_update('d0000003-2222-4222-8222-222222222222','{"displayName":"Legacy","username":"legacy_auth"}');
do $$ begin
 if (select optional_setup_pending from public.profiles where id='d0000003-2222-4222-8222-222222222222') then raise exception 'Legacy account repeats optional setup'; end if;
end $$;
reset role;
select 'ok 8 - missing legacy profile is repaired without optional onboarding';
rollback;
