-- Standalone TAP against real graph/RLS/RPCs; no pgTAP extension required.
begin;
select '1..10';
insert into auth.users(id,raw_user_meta_data)
 select ('e'||i||repeat(i::text,6)||'-1111-4111-8111-111111111111')::uuid,'{}'::jsonb
 from generate_series(1,6) i;
create temporary table hs(k text primary key,id uuid) on commit drop;
grant select on hs to authenticated;
grant all on hs to service_role;
insert into public.friendships(requester_id,addressee_id,status,accepted_at)
 select 'e1111111-1111-4111-8111-111111111111',('e'||i||repeat(i::text,6)||'-1111-4111-8111-111111111111')::uuid,'accepted',now()
 from generate_series(2,5) i;
insert into public.groups(id,name,owner_id) values('e0000000-1111-4111-8111-111111111111','Crew','e1111111-1111-4111-8111-111111111111');
insert into public.group_members(group_id,user_id,role)
 select 'e0000000-1111-4111-8111-111111111111',u::uuid,r from (values
 ('e1111111-1111-4111-8111-111111111111','owner'),('e2222222-1111-4111-8111-111111111111','member'),
 ('e6666666-1111-4111-8111-111111111111','member')) x(u,r);
set local role service_role;
insert into hs select 'friends',(public.hang_create('e1111111-1111-4111-8111-111111111111',
 jsonb_build_object('activity','Basketball','startsAt',now()+interval '1 hour','expiresAt',now()+interval '5 hours','audience','all_friends','groupId',null))->>'id')::uuid;
insert into hs select 'group',(public.hang_create('e1111111-1111-4111-8111-111111111111',
 jsonb_build_object('activity','Study','startsAt',now()+interval '1 hour','expiresAt',now()+interval '5 hours','audience','group','groupId','e0000000-1111-4111-8111-111111111111'))->>'id')::uuid;
do $$ declare p uuid := (select id from hs where k='friends'); begin
 perform public.hang_respond(p,'e2222222-1111-4111-8111-111111111111','down');
 perform public.hang_respond(p,'e2222222-1111-4111-8111-111111111111','maybe');
 if (select count(*) from public.hang_responses where post_id=p)<>1
 or (select status from public.hang_responses where post_id=p)<>'maybe' then raise exception 'Response not replaced'; end if;
 perform public.hang_respond(p,'e2222222-1111-4111-8111-111111111111','down');
 begin perform public.hang_respond(p,'e6666666-1111-4111-8111-111111111111','down');
 raise exception 'Nonfriend responded'; exception when sqlstate 'PT404' then null; end;
 if public.hang_get(p,'e6666666-1111-4111-8111-111111111111') is not null then raise exception 'Nonfriend sees post'; end if;
end $$;
select 'ok 1 - accepted friends respond and update one row; nonfriends denied';
do $$ declare p uuid := (select id from hs where k='group'); begin
 perform public.hang_respond(p,'e6666666-1111-4111-8111-111111111111','down');
 begin perform public.hang_respond(p,'e3333333-1111-4111-8111-111111111111','down');
 raise exception 'Nonmember responded'; exception when sqlstate 'PT404' then null; end;
end $$;
select 'ok 2 - current group membership grants access independently of friendship';
-- Reverse-direction block: responder blocks author. Existing friendship is removed.
select public.block_user('e3333333-1111-4111-8111-111111111111','e1111111-1111-4111-8111-111111111111');
do $$ begin
 if private.can_view_hang((select id from hs where k='friends'),'e3333333-1111-4111-8111-111111111111') then raise exception 'Blocked user sees post'; end if;
 begin perform public.hang_respond((select id from hs where k='friends'),'e3333333-1111-4111-8111-111111111111','down');
 raise exception 'Blocked user responded'; exception when sqlstate 'PT404' then null; end;
end $$;
select 'ok 3 - reverse-direction blocks deny visibility and responses';
reset role;
-- Restore friendship for exact-participant tests.
select public.unblock_user('e3333333-1111-4111-8111-111111111111','e1111111-1111-4111-8111-111111111111');
insert into public.friendships(requester_id,addressee_id,status,accepted_at) values
 ('e1111111-1111-4111-8111-111111111111','e3333333-1111-4111-8111-111111111111','accepted',now());
set local role authenticated;
select set_config('request.jwt.claim.sub','e6666666-1111-4111-8111-111111111111',true);
do $$ begin
 if (select count(*) from public.hang_posts)<>1 or (select audience from public.hang_posts)<>'group' then raise exception 'Hang RLS leaked friends post'; end if;
 begin insert into public.hang_responses(post_id,user_id,status) values((select id from hs where k='group'),auth.uid(),'down');
 raise exception 'Client direct write allowed'; exception when insufficient_privilege then null; end;
 begin perform public.hang_create_pick((select id from hs where k='group'),auth.uid(),'{}');
 raise exception 'Client RPC allowed'; exception when insufficient_privilege then null; end;
end $$;
select 'ok 4 - real RLS limits feed and forbids direct writes and mutation RPC access';
reset role;
set local role service_role;
select public.hang_respond((select id from hs where k='friends'),'e3333333-1111-4111-8111-111111111111','down');
select public.hang_respond((select id from hs where k='friends'),'e4444444-1111-4111-8111-111111111111','maybe');
select public.hang_respond((select id from hs where k='friends'),'e5555555-1111-4111-8111-111111111111','cant');
create temporary table hp as select public.hang_create_pick((select id from hs where k='friends'),
 'e1111111-1111-4111-8111-111111111111',
 '{"category":"custom","center":{"lat":40,"lng":-73},"radiusM":5000,"poolSize":4,"closeThreshold":100,"deadlineAt":null,"customOptions":[{"name":"Cards"},{"name":"Movie"},{"name":"Cookout"},{"name":"Study"}]}') r;
do $$ declare p uuid := (select (hp.r->>'pickId')::uuid from hp); begin
 if (select array_agg(user_id order by user_id) from public.pick_participants where pick_id=p)
 <> array['e2222222-1111-4111-8111-111111111111','e3333333-1111-4111-8111-111111111111']::uuid[] then raise exception 'Not exactly down responders'; end if;
 if (select host_id from public.picks where id=p)<>'e2222222-1111-4111-8111-111111111111' then raise exception 'Wrong delegated host'; end if;
 if (select plan_at from public.picks where id=p) is distinct from (select starts_at from public.hang_posts where id=(select id from hs where k='friends')) then raise exception 'Hang time lost'; end if;
 if (select jsonb_array_length(custom_options) from public.picks where id=p)<>4 then raise exception 'Canonical options lost'; end if;
end $$;
select 'ok 5 - exact down responders, no author/maybe/cant; canonical settings and hang time retained';
do $$ declare r jsonb; p uuid := (select (hp.r->>'pickId')::uuid from hp); begin
 r:=public.hang_create_pick((select id from hs where k='friends'),'e1111111-1111-4111-8111-111111111111','{}');
 if (r->>'pickId')::uuid<>p or (r->>'created')::boolean then raise exception 'Duplicate draft created'; end if;
 begin perform public.hang_create_pick((select id from hs where k='friends'),'e2222222-1111-4111-8111-111111111111','{}');
 raise exception 'Nonauthor created Pick'; exception when sqlstate 'PT403' then null; end;
end $$;
do $$ declare p uuid := (select (hp.r->>'pickId')::uuid from hp); users uuid[]; begin
 select array_agg(x::uuid) into users from jsonb_array_elements_text((select hp.r->'participantIds' from hp)) x;
 perform public.notify_insert(users,'added_to_pick',p,'{}');
 perform public.notify_insert(users,'added_to_pick',p,'{}');
 if (select count(*) from public.notifications where pick_id=p and type='added_to_pick')<>2 then raise exception 'Notifications duplicated or recipients wrong'; end if;
 if exists(select 1 from public.notifications where pick_id=p and user_id='e1111111-1111-4111-8111-111111111111') then raise exception 'Nondown author notified'; end if;
end $$;
select 'ok 6 - author only, draft reuse and existing notification deduplication';
-- Cancel old draft; a removed friend must not be copied into the next Pick.
update public.picks set state='canceled' where id=(select (hp.r->>'pickId')::uuid from hp);
select public.friend_remove('e1111111-1111-4111-8111-111111111111','e2222222-1111-4111-8111-111111111111');
do $$ declare r jsonb; begin
 r:=public.hang_create_pick((select id from hs where k='friends'),'e1111111-1111-4111-8111-111111111111',
 '{"category":"food","center":{"lat":40,"lng":-73},"radiusM":5000,"poolSize":5,"closeThreshold":100,"deadlineAt":null}');
 if r->'participantIds' <> '["e3333333-1111-4111-8111-111111111111"]'::jsonb then raise exception 'Removed friend included'; end if;
end $$;
do $$ declare r jsonb; p uuid; settings jsonb := '{"category":"food","center":{"lat":40,"lng":-73},"radiusM":5000,"poolSize":5,"deadlineAt":null,"closeThreshold":100}'; begin
 perform public.hang_respond((select id from hs where k='group'),'e2222222-1111-4111-8111-111111111111','down');
 r:=public.hang_create_pick((select id from hs where k='group'),'e1111111-1111-4111-8111-111111111111',settings);
 p:=(r->>'pickId')::uuid;
 if r->'participantIds' <> '["e2222222-1111-4111-8111-111111111111","e6666666-1111-4111-8111-111111111111"]'::jsonb
 or (select group_id from public.picks where id=p)<>'e0000000-1111-4111-8111-111111111111' then raise exception 'Group Pick membership/settings lost'; end if;
 update public.picks set state='canceled' where id=p;
 perform public.group_remove_member('e1111111-1111-4111-8111-111111111111','e0000000-1111-4111-8111-111111111111','e6666666-1111-4111-8111-111111111111');
 r:=public.hang_create_pick((select id from hs where k='group'),'e1111111-1111-4111-8111-111111111111',settings);
 if r->'participantIds' <> '["e2222222-1111-4111-8111-111111111111"]'::jsonb then raise exception 'Removed group member included'; end if;
 perform public.hang_respond((select id from hs where k='group'),'e2222222-1111-4111-8111-111111111111','maybe');
end $$;
select 'ok 7 - removed friends and group members excluded at Pick creation time';
-- Restore group membership to isolate the forward-block rule in the next test.
insert into public.group_members(group_id,user_id,role) values
 ('e0000000-1111-4111-8111-111111111111','e6666666-1111-4111-8111-111111111111','member');
select public.block_user('e1111111-1111-4111-8111-111111111111','e6666666-1111-4111-8111-111111111111');
do $$ begin
 begin perform public.hang_create_pick((select id from hs where k='group'),'e1111111-1111-4111-8111-111111111111','{}');
 raise exception 'Empty eligible down set created Pick'; exception when sqlstate 'PT409' then null; end;
 begin perform public.hang_respond((select id from hs where k='group'),'e6666666-1111-4111-8111-111111111111','down');
 raise exception 'Blocked group member responded'; exception when sqlstate 'PT404' then null; end;
end $$;
select 'ok 8 - blocked group responders excluded; no eligible down returns 409';
reset role;
update public.hang_posts set starts_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' where id=(select id from hs where k='friends');
set local role authenticated;
select set_config('request.jwt.claim.sub','e1111111-1111-4111-8111-111111111111',true);
do $$ begin
 if exists(select 1 from public.hang_posts where id=(select id from hs where k='friends')) then raise exception 'Expired post visible to author'; end if;
end $$;
reset role;
set local role service_role;
do $$ begin
 begin perform public.hang_respond((select id from hs where k='friends'),'e3333333-1111-4111-8111-111111111111','down');
 raise exception 'Expired response accepted'; exception when sqlstate 'PT404' then null; end;
 begin perform public.hang_create_pick((select id from hs where k='friends'),'e1111111-1111-4111-8111-111111111111','{}');
 raise exception 'Expired Pick accepted'; exception when sqlstate 'PT404' then null; end;
end $$;
select 'ok 9 - expired posts hidden even for author and responses rejected';
-- The original exact-two Pick still uses the normal host/start engine after hang expires.
reset role;
update public.picks set state='draft' where id=(select (hp.r->>'pickId')::uuid from hp);
set local role service_role;
select public.pick_start((select r->>'pickId' from hp),'e2222222-1111-4111-8111-111111111111',
 (select jsonb_agg(jsonb_build_object('placeId',o->>'placeId','snapshot',o))
 from public.picks p,jsonb_array_elements(p.custom_options) o where p.id=(select (hp.r->>'pickId')::uuid from hp)));
do $$ begin
 if (select state from public.picks where id=(select (hp.r->>'pickId')::uuid from hp))<>'swiping' then raise exception 'Normal start did not enter swiping'; end if;
end $$;
select 'ok 10 - delegated host starts normal canonical Custom Pick';
rollback;
