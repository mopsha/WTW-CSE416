-- Standalone TAP: accepted-friend-only authorization, RLS, retries and lifecycle.
begin;
select '1..13';
insert into auth.users(id,raw_user_meta_data) select ('e'||lpad(n::text,7,'0')||'-3333-4333-8333-333333333333')::uuid,jsonb_build_object('display_name','DM Person '||n) from generate_series(1,4)n;
insert into public.friendships(requester_id,addressee_id,status,accepted_at) values
 ('e0000001-3333-4333-8333-333333333333','e0000002-3333-4333-8333-333333333333','accepted',now()),
 ('e0000001-3333-4333-8333-333333333333','e0000003-3333-4333-8333-333333333333','pending',null),
 ('e0000001-3333-4333-8333-333333333333','e0000004-3333-4333-8333-333333333333','accepted',now());
set local role service_role;
select set_config('test.dm.id',public.direct_chat('open','e0000001-3333-4333-8333-333333333333','e0000002-3333-4333-8333-333333333333')->>'id',true);
do $$ declare r jsonb; who uuid; begin
 r:=public.direct_chat('open','e0000002-3333-4333-8333-333333333333','e0000001-3333-4333-8333-333333333333');
 if r->>'id'<>current_setting('test.dm.id') or (select count(*) from public.direct_conversations)<>1 then raise exception 'Duplicate pair'; end if;
 foreach who in array array['e0000001-3333-4333-8333-333333333333','e0000003-3333-4333-8333-333333333333','e0000009-3333-4333-8333-333333333333']::uuid[] loop
 begin perform public.direct_chat('open','e0000001-3333-4333-8333-333333333333',who); raise exception 'Self/pending/missing user allowed'; exception when sqlstate 'PT404' then null; end;
 end loop;
end $$;
select 'ok 1 - canonical pair reuses one conversation; self/pending/unavailable rejected';
select set_config('test.dm.message',public.direct_chat('send','e0000001-3333-4333-8333-333333333333',current_setting('test.dm.id')::uuid,'{"body":"Private hello","clientId":"request-0001","senderId":"e0000002-3333-4333-8333-333333333333"}')->'message'->>'id',true);
do $$ declare r jsonb; begin
 r:=public.direct_chat('list','e0000002-3333-4333-8333-333333333333',current_setting('test.dm.id')::uuid);
 if r->'messages'->0->>'senderId'<>'e0000001-3333-4333-8333-333333333333' or r->'conversation'->'peer'->>'id'<>'e0000001-3333-4333-8333-333333333333' then raise exception 'Sender/peer wrong'; end if;
 if r->'conversation'->'peer' ? 'favoriteCuisine' then raise exception 'Private metadata exposed'; end if;
end $$;
select 'ok 2 - authenticated sender only and basic peer projection';
do $$ declare r jsonb; begin
 r:=public.direct_chat('send','e0000001-3333-4333-8333-333333333333',current_setting('test.dm.id')::uuid,'{"body":"Private hello","clientId":"request-0001"}');
 if r->'message'->>'id'<>current_setting('test.dm.message') or (select count(*) from public.direct_messages)<>1 then raise exception 'Duplicate send'; end if;
 begin perform public.direct_chat('send','e0000001-3333-4333-8333-333333333333',current_setting('test.dm.id')::uuid,'{"body":"Changed","clientId":"request-0001"}'); raise exception 'Changed retry accepted'; exception when sqlstate 'PT409' then null; end;
end $$;
select 'ok 3 - retry-safe messages and conflicting reuse rejected';
do $$ declare payload jsonb:=jsonb_build_object('messageId',current_setting('test.dm.message')); n bigint; begin
 select count(*) into n from public.notify_insert(array['e0000001-3333-4333-8333-333333333333','e0000002-3333-4333-8333-333333333333','e0000004-3333-4333-8333-333333333333']::uuid[],'direct_message',null,payload);
 if n<>1 or exists(select 1 from public.notifications where type='direct_message' and (user_id<>'e0000002-3333-4333-8333-333333333333' or notifications.payload::text like '%Private%')) then raise exception 'Wrong/private notification'; end if;
 select count(*) into n from public.notify_insert(array['e0000002-3333-4333-8333-333333333333']::uuid[],'direct_message',null,payload);
 if n<>0 then raise exception 'Duplicate notification'; end if;
end $$;
select 'ok 4 - only recipient notified once; payload carries IDs only';
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','e0000002-3333-4333-8333-333333333333',true);
do $$ begin
 if (select count(*) from public.direct_messages)<>1 or (select count(*) from public.direct_conversations)<>1 then raise exception 'Peer RLS denied'; end if;
 begin insert into public.direct_messages(conversation_id,sender_id,body,client_id) values(current_setting('test.dm.id')::uuid,auth.uid(),'Spoof','request-0002'); raise exception 'Client write allowed'; exception when insufficient_privilege then null; end;
 begin perform public.direct_chat('list',auth.uid(),current_setting('test.dm.id')::uuid); raise exception 'Client RPC allowed'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','e0000004-3333-4333-8333-333333333333',true);
do $$ begin if exists(select 1 from public.direct_messages) or exists(select 1 from public.direct_conversations) then raise exception 'Other accepted friend accessed pair'; end if; end $$;
reset role;
select 'ok 5 - RLS limits to participants with friendship; direct writes/impersonation denied';
set local role service_role;
select public.friend_remove('e0000001-3333-4333-8333-333333333333','e0000002-3333-4333-8333-333333333333');
do $$ declare who uuid; action text; begin
 foreach who in array array['e0000001-3333-4333-8333-333333333333','e0000002-3333-4333-8333-333333333333']::uuid[] loop
 foreach action in array array['list','send'] loop
 begin perform public.direct_chat(action,who,current_setting('test.dm.id')::uuid,'{"body":"No","clientId":"request-0002"}'); raise exception 'Unfriended access'; exception when sqlstate 'PT404' then null; end;
 end loop;end loop;
 if (select count(*) from public.direct_messages)<>1 then raise exception 'Unfriend erased history'; end if;
 begin perform public.notify_insert(array['e0000002-3333-4333-8333-333333333333']::uuid[],'direct_message',null,jsonb_build_object('messageId',current_setting('test.dm.message'))); raise exception 'Unfriend notification allowed'; exception when sqlstate 'PT404' then null; end;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','e0000002-3333-4333-8333-333333333333',true);
do $$ begin if exists(select 1 from public.direct_messages) then raise exception 'Unfriend RLS access'; end if; end $$;
reset role;
select 'ok 6 - unfriend revokes API/RLS/notifications while retaining data';
set local role service_role;
insert into public.friendships(requester_id,addressee_id,status,accepted_at) values('e0000002-3333-4333-8333-333333333333','e0000001-3333-4333-8333-333333333333','accepted',now());
do $$ declare r jsonb; begin
 r:=public.direct_chat('open','e0000001-3333-4333-8333-333333333333','e0000002-3333-4333-8333-333333333333');
 if r->>'id'<>current_setting('test.dm.id') or jsonb_array_length(public.direct_chat('list','e0000002-3333-4333-8333-333333333333',current_setting('test.dm.id')::uuid)->'messages')<>1 then raise exception 'Refriend lost history'; end if;
end $$;
select 'ok 7 - accepted re-friendship restores the same historical conversation';
select public.block_user('e0000002-3333-4333-8333-333333333333','e0000001-3333-4333-8333-333333333333');
do $$ declare who uuid; begin
 foreach who in array array['e0000001-3333-4333-8333-333333333333','e0000002-3333-4333-8333-333333333333']::uuid[] loop
 begin perform public.direct_chat('list',who,current_setting('test.dm.id')::uuid); raise exception 'Blocked access'; exception when sqlstate 'PT404' then null; end;
 end loop;
 begin perform public.notify_insert(array['e0000002-3333-4333-8333-333333333333']::uuid[],'direct_message',null,jsonb_build_object('messageId',current_setting('test.dm.message'))); raise exception 'Blocked notification'; exception when sqlstate 'PT404' then null; end;
end $$;
select public.unblock_user('e0000002-3333-4333-8333-333333333333','e0000001-3333-4333-8333-333333333333');
do $$ begin
 begin perform public.direct_chat('open','e0000001-3333-4333-8333-333333333333','e0000002-3333-4333-8333-333333333333'); raise exception 'Unblock restored friendship'; exception when sqlstate 'PT404' then null; end;
end $$;
select 'ok 8 - either-direction blocking denies access/delivery; unblock does not restore friendship';
insert into public.friendships(requester_id,addressee_id,status) values('e0000001-3333-4333-8333-333333333333','e0000002-3333-4333-8333-333333333333','pending');
do $$ begin
 begin perform public.direct_chat('list','e0000001-3333-4333-8333-333333333333',current_setting('test.dm.id')::uuid); raise exception 'Pending re-request restored access'; exception when sqlstate 'PT404' then null; end;
end $$;
update public.friendships set status='accepted',accepted_at=now() where requester_id='e0000001-3333-4333-8333-333333333333' and addressee_id='e0000002-3333-4333-8333-333333333333';
select 'ok 9 - pending requests never restore access';
do $$ declare r jsonb; other_id uuid; i integer; begin
 other_id:=(public.direct_chat('open','e0000001-3333-4333-8333-333333333333','e0000004-3333-4333-8333-333333333333')->>'id')::uuid;
 begin perform public.direct_chat('send','e0000001-3333-4333-8333-333333333333',other_id,'{"body":"Private hello","clientId":"request-0001"}'); raise exception 'Cross-conversation retry accepted'; exception when sqlstate 'PT409' then null; end;
 for i in 1..55 loop perform public.direct_chat('send','e0000002-3333-4333-8333-333333333333',current_setting('test.dm.id')::uuid,jsonb_build_object('body',i::text,'clientId','history-'||lpad(i::text,4,'0'))); end loop;
 r:=public.direct_chat('list','e0000001-3333-4333-8333-333333333333',current_setting('test.dm.id')::uuid);
 if jsonb_array_length(r->'messages')<>50 or r->'messages'->0->>'body'<>'6' or r->'messages'->49->>'body'<>'55' then raise exception 'Unbounded/unordered history'; end if;
end $$;
select 'ok 10 - latest 50 chronological; retry IDs cannot cross conversations';
reset role;
delete from auth.users where id='e0000002-3333-4333-8333-333333333333';
do $$ begin
 if exists(select 1 from public.direct_conversations where id=current_setting('test.dm.id')::uuid) or exists(select 1 from public.direct_messages) or exists(select 1 from public.notifications where type='direct_message') then raise exception 'Orphan after deletion'; end if;
end $$;
select 'ok 11 - deleting either participant cascades conversation, all messages and notices';
set local role service_role;
do $$ begin
 begin perform public.direct_chat('list','e0000001-3333-4333-8333-333333333333',current_setting('test.dm.id')::uuid); raise exception 'Deleted conversation accessible'; exception when sqlstate 'PT404' then null; end;
 begin perform public.direct_chat('open','e0000001-3333-4333-8333-333333333333','e0000002-3333-4333-8333-333333333333'); raise exception 'Deleted peer available'; exception when sqlstate 'PT404' then null; end;
end $$;
reset role;
select 'ok 12 - no access or reopening after account deletion';
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='direct_messages') then raise exception 'Missing Realtime publication'; end if;
end $$;
select 'ok 13 - messages added to the existing Realtime publication';
rollback;
