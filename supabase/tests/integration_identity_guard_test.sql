begin;
select '1..7';
insert into auth.users(id) values('b0000001-6666-4666-8666-666666666666'),('b0000002-6666-4666-8666-666666666666');
set local role service_role;
select public.user_identity_update('b0000001-6666-4666-8666-666666666666','{"displayName":"Josh","username":"integration_josh"}');
do $$ declare input jsonb; begin
 foreach input in array array['{"username":null,"shareMetadata":true}','{"username":"","shareMetadata":true}','{"shareMetadata":true}']::jsonb[] loop
 begin perform public.user_profile_update('b0000001-6666-4666-8666-666666666666',input);raise exception 'Required username cleared';exception when sqlstate 'PT400' then null;end;
 end loop;
 if (select username from public.profiles where id='b0000001-6666-4666-8666-666666666666')<>'integration_josh' then raise exception 'Identity altered'; end if;
end $$;
select 'ok 1 - established identity cannot be erased by metadata/privacy writes';
do $$ declare result jsonb; begin
 result:=public.user_profile_update('b0000001-6666-4666-8666-666666666666','{"username":"integration_josh_2","favoriteCuisine":"Italian","shareMetadata":true}');
 if result->>'username'<>'integration_josh_2' or result->>'favoriteCuisine'<>'Italian' or result->>'shareMetadata'<>'true' then raise exception 'Normal edits broken';end if;
end $$;
select 'ok 2 - valid rename and privacy/favorite edits still work';
do $$ declare result jsonb; begin
 result:=public.user_profile_update('b0000002-6666-4666-8666-666666666666','{"username":null,"shareMetadata":false}');
 if result->>'username' is not null then raise exception 'Legacy nullable identity changed';end if;
end $$;
select 'ok 3 - legacy incomplete profiles remain compatible with required setup';
reset role;
set local role authenticated;
do $$ begin
 begin perform public.user_profile_update('b0000001-6666-4666-8666-666666666666','{"username":"attacker","shareMetadata":false}');raise exception 'Client RPC access';exception when insufficient_privilege then null;end;
end $$;
reset role;
select 'ok 4 - metadata/identity writes remain service-only';
set local role service_role;
insert into public.friendships(requester_id,addressee_id,status,accepted_at) values('b0000001-6666-4666-8666-666666666666','b0000002-6666-4666-8666-666666666666','accepted',now());
insert into public.groups(id,name,owner_id) values('b0000000-6666-4666-8666-666666666666','Integrated crew','b0000001-6666-4666-8666-666666666666');
insert into public.group_members(group_id,user_id,role) values('b0000000-6666-4666-8666-666666666666','b0000001-6666-4666-8666-666666666666','owner');
select public.group_invite_members('b0000001-6666-4666-8666-666666666666','b0000000-6666-4666-8666-666666666666',array['b0000002-6666-4666-8666-666666666666']::uuid[]);
do $$ declare invitation uuid; begin
 begin perform public.group_chat('list','b0000002-6666-4666-8666-666666666666','b0000000-6666-4666-8666-666666666666');raise exception 'Pending chat access';exception when sqlstate 'PT404' then null;end;
 begin perform public.group_ideas('list','b0000002-6666-4666-8666-666666666666','b0000000-6666-4666-8666-666666666666');raise exception 'Pending idea access';exception when sqlstate 'PT404' then null;end;
 select id into invitation from public.group_invitations where group_id='b0000000-6666-4666-8666-666666666666';
 perform public.group_invitation_resolve('b0000002-6666-4666-8666-666666666666',invitation,'accepted');
 perform public.group_chat('send','b0000002-6666-4666-8666-666666666666','b0000000-6666-4666-8666-666666666666','{"body":"Hello crew","clientId":"integration-001"}');
 perform public.group_ideas('create','b0000002-6666-4666-8666-666666666666','b0000000-6666-4666-8666-666666666666',null,'{"name":"Basketball","category":"activity"}');
end $$;
select 'ok 5 - direct invitation consent grants chat and Ideas access together';
select public.group_leave('b0000002-6666-4666-8666-666666666666','b0000000-6666-4666-8666-666666666666');
do $$ begin
 begin perform public.group_chat('list','b0000002-6666-4666-8666-666666666666','b0000000-6666-4666-8666-666666666666');raise exception 'Former chat access';exception when sqlstate 'PT404' then null;end;
 begin perform public.group_ideas('list','b0000002-6666-4666-8666-666666666666','b0000000-6666-4666-8666-666666666666');raise exception 'Former idea access';exception when sqlstate 'PT404' then null;end;
 if (select count(*) from public.group_messages where group_id='b0000000-6666-4666-8666-666666666666')<>1 then raise exception 'History erased';end if;
end $$;
select 'ok 6 - leave revokes current chat/Ideas access while preserving messages';
do $$ declare conversation uuid; begin
 conversation:=(public.direct_chat('open','b0000001-6666-4666-8666-666666666666','b0000002-6666-4666-8666-666666666666')->>'id')::uuid;
 perform public.friend_remove('b0000001-6666-4666-8666-666666666666','b0000002-6666-4666-8666-666666666666');
 begin perform public.direct_chat('list','b0000001-6666-4666-8666-666666666666',conversation);raise exception 'Unfriend DM access';exception when sqlstate 'PT404' then null;end;
 begin perform public.user_profile_get('b0000001-6666-4666-8666-666666666666','b0000002-6666-4666-8666-666666666666');raise exception 'Unfriend profile access';exception when sqlstate 'PT404' then null;end;
 begin perform public.profile_past_moves('b0000001-6666-4666-8666-666666666666','b0000002-6666-4666-8666-666666666666');raise exception 'Unfriend memory access';exception when sqlstate 'PT404' then null;end;
end $$;
reset role;
select 'ok 7 - friendship removal consistently revokes DM/profile/Past Moves projections';
rollback;
