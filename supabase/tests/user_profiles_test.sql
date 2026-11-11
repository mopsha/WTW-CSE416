-- Standalone TAP: safe projections, unique usernames, metadata grants and current graph.
begin;
select '1..11';
insert into auth.users(id,raw_user_meta_data) select ('b'||lpad(n::text,7,'0')||'-2222-4222-8222-222222222222')::uuid,jsonb_build_object('display_name','Person '||n) from generate_series(1,4)n;
insert into public.friendships(requester_id,addressee_id,status,accepted_at) values
 ('b0000001-2222-4222-8222-222222222222','b0000002-2222-4222-8222-222222222222','accepted',now()),
 ('b0000001-2222-4222-8222-222222222222','b0000003-2222-4222-8222-222222222222','pending',null);
insert into public.groups(id,name,owner_id) values
 ('b0000000-2222-4222-8222-222222222222','Shared','b0000001-2222-4222-8222-222222222222'),
 ('c0000000-2222-4222-8222-222222222222','Private group','b0000002-2222-4222-8222-222222222222');
insert into public.group_members(group_id,user_id,role) values
 ('b0000000-2222-4222-8222-222222222222','b0000001-2222-4222-8222-222222222222','owner'),
 ('b0000000-2222-4222-8222-222222222222','b0000002-2222-4222-8222-222222222222','member'),
 ('c0000000-2222-4222-8222-222222222222','b0000002-2222-4222-8222-222222222222','owner');
update public.profiles set avatar_url='https://example.com/avatar.png' where id='b0000002-2222-4222-8222-222222222222';
set local role service_role;
do $$ declare r jsonb; begin
 r:=public.user_profile_update('b0000002-2222-4222-8222-222222222222','{"username":"Josh","favoriteCuisine":"Japanese","favoriteActivity":"Basketball","shareMetadata":false}');
 if r->>'username'<>'josh' or r->>'favoriteCuisine'<>'Japanese' or r->>'friendsCount'<>'1' or r->>'groupsCount'<>'2' or r->>'metadataVisible'<>'true' or r->>'avatarUrl'<>'https://example.com/avatar.png' then raise exception 'Owner projection wrong'; end if;
end $$;
select 'ok 1 - owner sees full metadata even with privacy off; existing avatar preserved';
do $$ declare r jsonb; begin
 r:=public.user_profile_get('b0000001-2222-4222-8222-222222222222','b0000002-2222-4222-8222-222222222222');
 if r->>'username'<>'josh' or r->>'friendsCount' is not null or r->>'groupsCount' is not null or r->>'favoriteCuisine' is not null or r->>'favoriteActivity' is not null or r->'mutualGroups'<>'[]' or r ? 'shareMetadata' or r ? 'discover_preferences' then raise exception 'Private metadata leaked'; end if;
end $$;
select 'ok 2 - accepted friend sees identity only when metadata private';
select public.user_profile_update('b0000002-2222-4222-8222-222222222222','{"username":"josh","favoriteCuisine":"Japanese","favoriteActivity":"Basketball","shareMetadata":true}');
do $$ declare r jsonb; begin
 r:=public.user_profile_get('b0000001-2222-4222-8222-222222222222','b0000002-2222-4222-8222-222222222222');
 if r->>'groupsCount'<>'2' or r->>'favoriteCuisine'<>'Japanese' or jsonb_array_length(r->'mutualGroups')<>1 or r->'mutualGroups'->0->>'name'<>'Shared' then raise exception 'Mutual groups projection wrong'; end if;
 if r::text like '%Private group%' then raise exception 'Private group name leaked'; end if;
end $$;
select 'ok 3 - sharing reveals counts/favorites but only mutually accessible group names';
-- Regression: 0038 adds a birthday record named b. Its fields must never shadow
-- group-member aliases when the non-owner, metadata-visible branch is planned.
select public.user_profile_update('b0000002-2222-4222-8222-222222222222','{"username":"josh","shareMetadata":true,"birthday":{"month":2,"day":29},"shareBirthday":true}');
do $$ declare r jsonb; begin
 r:=public.user_profile_get('b0000001-2222-4222-8222-222222222222','b0000002-2222-4222-8222-222222222222');
 if r->'mutualGroups' is distinct from '[{"id":"b0000000-2222-4222-8222-222222222222","name":"Shared"}]'::jsonb
  or r->'birthday' is distinct from '{"month":2,"day":29}'::jsonb then raise exception 'Birthday/shared-group projection regression'; end if;
 if r::text like '%Private group%' or r ? 'shareBirthday' then raise exception 'Private group or owner preference leaked'; end if;
end $$;
select 'ok 4 - birthday record coexists with shared-group projection and excludes non-shared groups';
do $$ declare viewer uuid; begin
 foreach viewer in array array['b0000003-2222-4222-8222-222222222222','b0000004-2222-4222-8222-222222222222']::uuid[] loop
 begin perform public.user_profile_get(viewer,'b0000001-2222-4222-8222-222222222222'); raise exception 'Pending/stranger accessed'; exception when sqlstate 'PT404' then null; end;
 end loop;
 begin perform public.user_profile_get(null,'b0000001-2222-4222-8222-222222222222'); raise exception 'Null viewer accessed'; exception when sqlstate 'PT404' then null; end;
end $$;
select 'ok 5 - pending/nonfriend/null callers denied regardless of metadata setting';
do $$ begin
 begin perform public.user_profile_update('b0000001-2222-4222-8222-222222222222','{"username":"JOSH","shareMetadata":false}'); raise exception 'Duplicate username'; exception when unique_violation then null; end;
 begin perform public.user_profile_update('b0000001-2222-4222-8222-222222222222','{"username":"bad name","shareMetadata":false}'); raise exception 'Bad username'; exception when sqlstate 'PT400' then null; end;
end $$;
select 'ok 6 - database enforces normalized unique username and shape';
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','b0000001-2222-4222-8222-222222222222',true);
do $$ begin
 begin perform favorite_cuisine from public.profiles; raise exception 'Direct private-column access'; exception when insufficient_privilege then null; end;
 begin perform username from public.profiles; raise exception 'Direct username access'; exception when insufficient_privilege then null; end;
 begin perform public.user_profile_get(auth.uid(),'b0000002-2222-4222-8222-222222222222'); raise exception 'Client called service projection'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'ok 7 - existing RLS/column permissions do not expose new metadata or RPC impersonation';
set local role service_role;
select public.block_user('b0000002-2222-4222-8222-222222222222','b0000001-2222-4222-8222-222222222222');
do $$ begin
 begin perform public.user_profile_get('b0000001-2222-4222-8222-222222222222','b0000002-2222-4222-8222-222222222222'); raise exception 'Blocked viewer accessed'; exception when sqlstate 'PT404' then null; end;
 begin perform public.user_profile_get('b0000002-2222-4222-8222-222222222222','b0000001-2222-4222-8222-222222222222'); raise exception 'Blocker accessed'; exception when sqlstate 'PT404' then null; end;
end $$;
select 'ok 8 - both block directions deny profiles despite shared group';
select public.unblock_user('b0000002-2222-4222-8222-222222222222','b0000001-2222-4222-8222-222222222222');
reset role;
insert into public.friendships(requester_id,addressee_id,status,accepted_at) values ('b0000001-2222-4222-8222-222222222222','b0000002-2222-4222-8222-222222222222','accepted',now());
delete from public.group_members where group_id='b0000000-2222-4222-8222-222222222222' and user_id='b0000002-2222-4222-8222-222222222222';
set local role service_role;
do $$ begin
 if public.user_profile_get('b0000001-2222-4222-8222-222222222222','b0000002-2222-4222-8222-222222222222')->'mutualGroups'<>'[]' then raise exception 'Removed mutual membership leaked'; end if;
 if public.user_profile_get('b0000001-2222-4222-8222-222222222222','b0000002-2222-4222-8222-222222222222')->'birthday' is distinct from '{"month":2,"day":29}'::jsonb then raise exception 'Authorized birthday lost after leaving shared group'; end if;
end $$;
select 'ok 9 - mutual group projection uses current membership';
select public.friend_remove('b0000001-2222-4222-8222-222222222222','b0000002-2222-4222-8222-222222222222');
do $$ begin
 begin perform public.user_profile_get('b0000001-2222-4222-8222-222222222222','b0000002-2222-4222-8222-222222222222'); raise exception 'Removed friendship accessed'; exception when sqlstate 'PT404' then null; end;
end $$;
select 'ok 10 - friendship removal immediately revokes endpoint access';
reset role;
delete from auth.users where id='b0000002-2222-4222-8222-222222222222';
set local role service_role;
select public.user_profile_update('b0000001-2222-4222-8222-222222222222','{"username":"josh","shareMetadata":false}');
do $$ begin
 if exists(select 1 from public.profiles where id='b0000002-2222-4222-8222-222222222222') then raise exception 'Deleted metadata retained'; end if;
 begin perform public.user_profile_get('b0000001-2222-4222-8222-222222222222','b0000002-2222-4222-8222-222222222222'); raise exception 'Deleted profile retrieved'; exception when sqlstate 'PT404' then null; end;
end $$;
select 'ok 11 - account deletion removes metadata and releases username';
rollback;
