begin;
select '1..7';
insert into auth.users(id,email,raw_user_meta_data) values
 ('a0360001-3333-4333-8333-333333333333','username-one@example.invalid','{}'),
 ('a0360002-3333-4333-8333-333333333333','username-two@example.invalid','{}'),
 ('a0360003-3333-4333-8333-333333333333','username-three@example.invalid','{}');
set local role service_role;
do $$ begin
 perform public.user_identity_update('a0360001-3333-4333-8333-333333333333','{"displayName":"One","username":"ONE_PERSON"}');
 perform public.user_identity_update('a0360002-3333-4333-8333-333333333333','{"displayName":"Two","username":"two_person"}');
 if (select username from public.profiles where id='a0360001-3333-4333-8333-333333333333')<>'one_person' then raise exception 'Not normalized'; end if;
 begin
  perform public.user_identity_update('a0360002-3333-4333-8333-333333333333','{"displayName":"Overwrite","username":"One_Person"}');
  raise exception 'Duplicate allowed';
 exception when unique_violation then null; end;
 if (select display_name from public.profiles where id='a0360002-3333-4333-8333-333333333333')<>'Two' then raise exception 'Conflict partially changed identity'; end if;
end $$;
select 'ok 1 - missing usernames are chosen atomically with case-insensitive uniqueness';
do $$ declare value text; begin
 foreach value in array array['   ','bad name','admin','SUPPORT'] loop
  begin
   update public.profiles set username=value where id='a0360003-3333-4333-8333-333333333333';
   raise exception 'Invalid username allowed';
  exception when sqlstate 'PT400' then null; end;
 end loop;
end $$;
select 'ok 2 - database rejects invalid and reserved new claims';
do $$ declare result jsonb; begin
 result:=public.username_search('a0360001-3333-4333-8333-333333333333','@TWO');
 if jsonb_array_length(result)<>1 or result->0->>'username'<>'two_person' or result->0->>'relationship'<>'none'
  or result->0 ? 'email' or result->0 ? 'favoriteCuisine' or result->0 ? 'avatarUrl' then raise exception 'Unsafe identity projection'; end if;
 if public.username_search('a0360001-3333-4333-8333-333333333333','t_o')<>'[]'::jsonb then raise exception 'Underscore acted as wildcard'; end if;
 perform public.friend_request_username('a0360001-3333-4333-8333-333333333333','two_person','a0360002-3333-4333-8333-333333333333');
 perform public.friend_request_username('a0360001-3333-4333-8333-333333333333','two_person','a0360002-3333-4333-8333-333333333333');
 if public.person_lookup('a0360001-3333-4333-8333-333333333333','a0360002-3333-4333-8333-333333333333')->>'relationship'<>'requested' then raise exception 'Missing outgoing state'; end if;
 if public.person_lookup('a0360002-3333-4333-8333-333333333333','a0360001-3333-4333-8333-333333333333')->>'relationship'<>'incoming' then raise exception 'Missing incoming state'; end if;
 perform public.friend_accept('a0360002-3333-4333-8333-333333333333','a0360001-3333-4333-8333-333333333333');
 if public.person_lookup('a0360001-3333-4333-8333-333333333333','a0360002-3333-4333-8333-333333333333')->>'relationship'<>'friends' then raise exception 'Missing accepted state'; end if;

 -- A stale result must never add a different account that reclaimed its handle.
 perform public.friend_remove('a0360001-3333-4333-8333-333333333333','a0360002-3333-4333-8333-333333333333');
 update public.profiles set username='two_renamed' where id='a0360002-3333-4333-8333-333333333333';
 update public.profiles set username='two_person' where id='a0360003-3333-4333-8333-333333333333';
 perform public.friend_request_username('a0360001-3333-4333-8333-333333333333','two_person','a0360002-3333-4333-8333-333333333333');
 if exists(select 1 from public.friendships where requester_id='a0360001-3333-4333-8333-333333333333') then raise exception 'Stale search targeted a different identity'; end if;
 if public.person_lookup('a0360001-3333-4333-8333-333333333333','a0360002-3333-4333-8333-333333333333')->>'username'<>'two_renamed' then raise exception 'Shared ID broke after rename'; end if;
 update public.profiles set username=null where id='a0360003-3333-4333-8333-333333333333';
 update public.profiles set username='two_person' where id='a0360002-3333-4333-8333-333333333333';
end $$;
select 'ok 3 - bounded username discovery and canonical friend requests expose correct safe states';
do $$ begin
 perform public.block_user('a0360002-3333-4333-8333-333333333333','a0360001-3333-4333-8333-333333333333');
 if public.username_search('a0360001-3333-4333-8333-333333333333','two')<>'[]'::jsonb
  or public.person_lookup('a0360001-3333-4333-8333-333333333333','a0360002-3333-4333-8333-333333333333') is not null
  or public.person_lookup('a0360002-3333-4333-8333-333333333333','a0360001-3333-4333-8333-333333333333') is not null then raise exception 'Block bypassed'; end if;
 perform public.friend_request_username('a0360001-3333-4333-8333-333333333333','two_person','a0360002-3333-4333-8333-333333333333');
 if exists(select 1 from public.friendships where requester_id='a0360001-3333-4333-8333-333333333333') then raise exception 'Blocked request created'; end if;
end $$;
select 'ok 4 - either-direction blocking denies lookup and requests';
do $$ begin
 for i in 1..30 loop
  if public.person_lookup('a0360003-3333-4333-8333-333333333333','a0369999-3333-4333-8333-333333333333') is not null then raise exception 'Unknown profile returned'; end if;
 end loop;
 begin perform public.username_search('a0360003-3333-4333-8333-333333333333','two'); raise exception 'Quota bypass'; exception when sqlstate 'PT429' then null; end;
 if (select calls from public.rate_limit_counters where scope='username_lookup' and subject='a0360003-3333-4333-8333-333333333333')<>30 then raise exception 'Missing lookups did not spend shared quota'; end if;
end $$;
select 'ok 5 - failed UUID lookups and searches share one atomic bounded quota';
do $$ begin
 if has_function_privilege('anon','public.username_search(uuid,text)','execute')
 or has_function_privilege('authenticated','public.person_lookup(uuid,uuid)','execute')
 or has_function_privilege('authenticated','public.friend_request_username(uuid,text,uuid)','execute')
 or has_function_privilege('authenticated','private.username_request_email(uuid)','execute') then raise exception 'Client privileged RPC grant'; end if;
end $$;
select 'ok 6 - public clients cannot impersonate viewers or read internal emails';
select public.unblock_user('a0360002-3333-4333-8333-333333333333','a0360001-3333-4333-8333-333333333333');
reset role;
update public.profiles set avatar_deletion_pending=true where id='a0360002-3333-4333-8333-333333333333';
set local role service_role;
do $$ begin
 if public.person_lookup('a0360001-3333-4333-8333-333333333333','a0360002-3333-4333-8333-333333333333') is not null then raise exception 'Deleting target returned'; end if;
end $$;
select 'ok 7 - deleting profiles remain unavailable';
rollback;
