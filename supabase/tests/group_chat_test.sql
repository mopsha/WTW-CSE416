-- Standalone TAP, real RLS and RPC checks. Fixtures roll back.
begin;
select '1..13';
insert into auth.users(id,raw_user_meta_data) select ('f'||lpad(n::text,7,'0')||'-2222-4222-8222-222222222222')::uuid,jsonb_build_object('display_name','Person '||n) from generate_series(1,5)n;
insert into public.groups(id,name,owner_id) values ('f0000000-2222-4222-8222-222222222222','Chat group','f0000001-2222-4222-8222-222222222222');
insert into public.group_members(group_id,user_id,role) select 'f0000000-2222-4222-8222-222222222222',('f'||lpad(n::text,7,'0')||'-2222-4222-8222-222222222222')::uuid,case when n=1 then 'owner' else 'member' end from generate_series(1,3)n;
insert into public.friendships(requester_id,addressee_id,status,accepted_at) values('f0000001-2222-4222-8222-222222222222','f0000004-2222-4222-8222-222222222222','accepted',now());
select public.group_invite_members('f0000001-2222-4222-8222-222222222222','f0000000-2222-4222-8222-222222222222',array['f0000004-2222-4222-8222-222222222222']::uuid[]);
set local role service_role;
do $$ declare r jsonb; begin
 r:=public.group_chat('send','f0000002-2222-4222-8222-222222222222','f0000000-2222-4222-8222-222222222222','{"body":"Hello group","clientId":"request-0001","senderId":"f0000001-2222-4222-8222-222222222222"}');
 if r->'message'->>'senderId'<>'f0000002-2222-4222-8222-222222222222' or jsonb_array_length(r->'recipientIds')<>2 then raise exception 'Sender/recipients incorrect'; end if;
end $$;
select 'ok 1 - member sends as verified caller and sender excluded from recipients';
do $$ declare first jsonb; second jsonb; begin
 first:=public.group_chat('list','f0000001-2222-4222-8222-222222222222','f0000000-2222-4222-8222-222222222222');
 second:=public.group_chat('send','f0000002-2222-4222-8222-222222222222','f0000000-2222-4222-8222-222222222222','{"body":"Hello group","clientId":"request-0001"}');
 if first->0->>'id'<>second->'message'->>'id' or (select count(*) from public.group_messages)<>1 then raise exception 'Retry duplicated'; end if;
 begin perform public.group_chat('send','f0000002-2222-4222-8222-222222222222','f0000000-2222-4222-8222-222222222222','{"body":"Changed","clientId":"request-0001"}'); raise exception 'Changed retry accepted'; exception when sqlstate 'PT409' then null; end;
end $$;
select 'ok 2 - retries reuse one message; conflicting reuse rejected';
do $$ declare who uuid; action text; begin
 foreach who in array array['f0000004-2222-4222-8222-222222222222','f0000005-2222-4222-8222-222222222222']::uuid[] loop
 foreach action in array array['list','send'] loop
 begin perform public.group_chat(action,who,'f0000000-2222-4222-8222-222222222222','{"body":"No","clientId":"request-0002"}'); raise exception 'Nonmember/pending invitee accessed'; exception when sqlstate 'PT404' then null; end;
 end loop;end loop;
end $$;
select 'ok 3 - nonmembers and pending invitees cannot list/send';
do $$ declare payload jsonb; n bigint; begin
 select jsonb_build_object('messageId',id) into payload from public.group_messages limit 1;
 select count(*) into n from public.notify_insert(array['f0000001-2222-4222-8222-222222222222','f0000002-2222-4222-8222-222222222222','f0000003-2222-4222-8222-222222222222','f0000004-2222-4222-8222-222222222222']::uuid[],'group_message',null,payload);
 if n<>2 then raise exception 'Wrong notification recipients'; end if;
 select count(*) into n from public.notify_insert(array['f0000001-2222-4222-8222-222222222222','f0000003-2222-4222-8222-222222222222']::uuid[],'group_message',null,payload);
 if n<>0 or exists(select 1 from public.notifications nn where nn.type='group_message' and nn.payload::text like '%Hello%') then raise exception 'Duplicate or private text leaked'; end if;
end $$;
select 'ok 4 - notification dedup excludes sender/nonmembers and carries no message text';
select public.block_user('f0000001-2222-4222-8222-222222222222','f0000002-2222-4222-8222-222222222222');
do $$ declare r jsonb; begin
 r:=public.group_chat('list','f0000001-2222-4222-8222-222222222222','f0000000-2222-4222-8222-222222222222');
 if jsonb_array_length(r)<>0 then raise exception 'Blocked messages visible'; end if;
 r:=public.group_chat('send','f0000001-2222-4222-8222-222222222222','f0000000-2222-4222-8222-222222222222','{"body":"Owner text","clientId":"request-0003"}');
 if r->'recipientIds' ? 'f0000002-2222-4222-8222-222222222222' then raise exception 'Blocked notification'; end if;
 r:=public.group_chat('list','f0000002-2222-4222-8222-222222222222','f0000000-2222-4222-8222-222222222222');
 if jsonb_array_length(r)<>1 then raise exception 'Reverse block not applied'; end if;
end $$;
select 'ok 5 - existing shared membership preserved but blocked messages hidden both ways';
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','f0000001-2222-4222-8222-222222222222',true);
do $$ begin
 if (select count(*) from public.group_messages)<>1 then raise exception 'RLS blocked read wrong'; end if;
 begin insert into public.group_messages(group_id,sender_id,body,client_id) values('f0000000-2222-4222-8222-222222222222',auth.uid(),'Attack','request-0004'); raise exception 'Client write permitted'; exception when insufficient_privilege then null; end;
 begin perform public.group_chat('list',auth.uid(),'f0000000-2222-4222-8222-222222222222'); raise exception 'Client RPC permitted'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','f0000004-2222-4222-8222-222222222222',true);
do $$ begin if exists(select 1 from public.group_messages) then raise exception 'RLS pending invitee read'; end if; end $$;
reset role;
select 'ok 6 - direct RLS reads honor membership/blocking; all client writes/RPC impersonation denied';
set local role service_role;
select public.group_remove_member('f0000001-2222-4222-8222-222222222222','f0000000-2222-4222-8222-222222222222','f0000002-2222-4222-8222-222222222222');
do $$ begin
 begin perform public.group_chat('list','f0000002-2222-4222-8222-222222222222','f0000000-2222-4222-8222-222222222222'); raise exception 'Removed member read'; exception when sqlstate 'PT404' then null; end;
 begin perform public.group_chat('send','f0000002-2222-4222-8222-222222222222','f0000000-2222-4222-8222-222222222222','{"body":"No","clientId":"request-0005"}'); raise exception 'Removed member sent'; exception when sqlstate 'PT404' then null; end;
 if jsonb_array_length(public.group_chat('list','f0000003-2222-4222-8222-222222222222','f0000000-2222-4222-8222-222222222222'))<>2 then raise exception 'History removed'; end if;
end $$;
select 'ok 7 - removal revokes API access without deleting historical messages';
do $$ declare payload jsonb; n bigint; begin
 select jsonb_build_object('messageId',id) into payload from public.group_messages where sender_id='f0000001-2222-4222-8222-222222222222';
 select count(*) into n from public.notify_insert(array['f0000002-2222-4222-8222-222222222222']::uuid[],'group_message',null,payload);
 if n<>0 then raise exception 'Removed recipient notified'; end if;
end $$;
select 'ok 8 - notification delivery rechecks current membership';
select public.group_leave('f0000003-2222-4222-8222-222222222222','f0000000-2222-4222-8222-222222222222');
do $$ begin
 begin perform public.group_chat('list','f0000003-2222-4222-8222-222222222222','f0000000-2222-4222-8222-222222222222'); raise exception 'Left member read'; exception when sqlstate 'PT404' then null; end;
end $$;
select 'ok 9 - leaving revokes access';
do $$ declare r jsonb; i integer; begin
 -- Historical page fixtures represent paced sends, not a burst. Age quota events only.
 for i in 1..55 loop
 update public.rate_limit_events set created_at=clock_timestamp()-interval '2 hours' where action='message_send';
 perform public.group_chat('send','f0000001-2222-4222-8222-222222222222','f0000000-2222-4222-8222-222222222222',jsonb_build_object('body',i::text,'clientId','history-'||lpad(i::text,4,'0'))); end loop;
 r:=public.group_chat('list','f0000001-2222-4222-8222-222222222222','f0000000-2222-4222-8222-222222222222');
 if jsonb_array_length(r)<>50 or r->0->>'body'<>'6' or r->49->>'body'<>'55' then raise exception 'Unbounded/unordered history'; end if;
end $$;
select 'ok 10 - recent history bounded to 50 and chronological';
reset role;
delete from auth.users where id='f0000002-2222-4222-8222-222222222222';
do $$ begin
 if exists(select 1 from public.group_messages where sender_id='f0000002-2222-4222-8222-222222222222') or exists(select 1 from public.notifications where type='group_message') then raise exception 'Deleted sender message/notifications retained'; end if;
end $$;
select 'ok 11 - account deletion removes authored messages and linked notices';
delete from public.groups where id='f0000000-2222-4222-8222-222222222222';
do $$ begin if exists(select 1 from public.group_messages) then raise exception 'Orphaned group message'; end if; end $$;
select 'ok 12 - group deletion cascades all messages';
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='group_messages') then raise exception 'Chat missing from publication'; end if;
end $$;
select 'ok 13 - chat joins existing Realtime publication when installed';
rollback;
