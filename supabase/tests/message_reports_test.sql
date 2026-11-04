-- Standalone TAP, message reports (0033). Fixtures roll back.
begin;
select '1..10';
insert into auth.users(id,raw_user_meta_data) select ('e'||lpad(n::text,7,'0')||'-2222-4222-8222-222222222222')::uuid,jsonb_build_object('display_name','Person '||n) from generate_series(1,3)n;
insert into public.groups(id,name,owner_id) values ('e0000000-2222-4222-8222-222222222222','Reports group','e0000001-2222-4222-8222-222222222222');
insert into public.group_members(group_id,user_id,role) values
 ('e0000000-2222-4222-8222-222222222222','e0000001-2222-4222-8222-222222222222','owner'),
 ('e0000000-2222-4222-8222-222222222222','e0000002-2222-4222-8222-222222222222','member');
insert into public.group_messages(id,group_id,sender_id,body,client_id) values
 ('e0000010-2222-4222-8222-222222222222','e0000000-2222-4222-8222-222222222222','e0000002-2222-4222-8222-222222222222','Group words','report-test-1');
insert into public.direct_conversations(id,user_low,user_high) values
 ('e0000020-2222-4222-8222-222222222222','e0000001-2222-4222-8222-222222222222','e0000002-2222-4222-8222-222222222222');
insert into public.direct_messages(id,conversation_id,sender_id,body,client_id) values
 ('e0000021-2222-4222-8222-222222222222','e0000020-2222-4222-8222-222222222222','e0000002-2222-4222-8222-222222222222','Direct words','report-test-2');
create function pg_temp.denied(p_user uuid,p_kind text,p_target uuid) returns boolean language plpgsql as $$
begin
 perform public.report_create(p_user,p_kind,p_target,'Abuse');
 return false;
exception when sqlstate 'PT404' then return true;
end $$;

do $$ begin
 perform public.report_create('e0000001-2222-4222-8222-222222222222','group_message','e0000010-2222-4222-8222-222222222222','Abuse');
 if not exists(select 1 from public.reports where target_kind='group_message' and message_body='Group words' and reported_user_id='e0000002-2222-4222-8222-222222222222') then raise exception 'Group report missing its copy'; end if;
end $$;
select 'ok 1 - group member reports a message and the report keeps a copy';
do $$ begin
 perform public.report_create('e0000001-2222-4222-8222-222222222222','direct_message','e0000021-2222-4222-8222-222222222222','Abuse');
 if not exists(select 1 from public.reports where target_kind='direct_message' and message_body='Direct words' and reported_user_id='e0000002-2222-4222-8222-222222222222') then raise exception 'Direct report missing its copy'; end if;
end $$;
select 'ok 2 - conversation participant reports a message and the report keeps a copy';
do $$ begin
 if not pg_temp.denied('e0000003-2222-4222-8222-222222222222','group_message','e0000010-2222-4222-8222-222222222222')
    or not pg_temp.denied('e0000003-2222-4222-8222-222222222222','direct_message','e0000021-2222-4222-8222-222222222222') then raise exception 'Outsider could report'; end if;
end $$;
select 'ok 3 - outsiders cannot report, and the message is not confirmed to exist';
do $$ begin
 if not pg_temp.denied('e0000002-2222-4222-8222-222222222222','group_message','e0000010-2222-4222-8222-222222222222')
    or not pg_temp.denied('e0000002-2222-4222-8222-222222222222','direct_message','e0000021-2222-4222-8222-222222222222') then raise exception 'Own message reportable'; end if;
end $$;
select 'ok 4 - nobody reports their own message';
do $$ begin
 if (select count(*) from private.report_queue)<>2 then raise exception 'Queue wrong'; end if;
 update public.reports set reviewed_at=now() where target_kind='direct_message';
 if (select count(*) from private.report_queue)<>1 then raise exception 'Reviewed report still queued'; end if;
end $$;
select 'ok 5 - the queue lists only reports not yet reviewed';
do $$ begin
 if has_table_privilege('authenticated','public.reports','select') or has_table_privilege('authenticated','private.report_queue','select') or has_table_privilege('anon','private.report_queue','select') then raise exception 'Clients can read reports'; end if;
end $$;
select 'ok 6 - clients cannot read reports or the queue';
insert into public.friendships(requester_id,addressee_id,status,accepted_at) values('e0000001-2222-4222-8222-222222222222','e0000002-2222-4222-8222-222222222222','accepted',now());
delete from public.friendships where requester_id='e0000001-2222-4222-8222-222222222222' and addressee_id='e0000002-2222-4222-8222-222222222222';
do $$ begin
 perform public.report_create('e0000001-2222-4222-8222-222222222222','direct_message','e0000021-2222-4222-8222-222222222222','Abuse');
end $$;
select 'ok 7 - unfriending does not remove the right to report a direct message';
do $$
declare before_count bigint; sender uuid:='e0000002-2222-4222-8222-222222222222'; me uuid:='e0000001-2222-4222-8222-222222222222';
begin
 select count(*) into before_count from public.reports;
 perform public.block_user(sender,me);
 perform public.report_create(me,'group_message','e0000010-2222-4222-8222-222222222222','Abuse');
 perform public.report_create(me,'direct_message','e0000021-2222-4222-8222-222222222222','Abuse');
 perform public.unblock_user(sender,me);
 perform public.block_user(me,sender);
 perform public.report_create(me,'group_message','e0000010-2222-4222-8222-222222222222','Abuse');
 perform public.report_create(me,'direct_message','e0000021-2222-4222-8222-222222222222','Abuse');
 if (select count(*) from public.reports)<>before_count+4 then raise exception 'Reports missing after block'; end if;
end $$;
select 'ok 8 - blocking in either direction does not remove the right to report';
do $$ begin
 if not pg_temp.denied('e0000003-2222-4222-8222-222222222222','group_message','e0000010-2222-4222-8222-222222222222')
    or not pg_temp.denied('e0000003-2222-4222-8222-222222222222','direct_message','e0000021-2222-4222-8222-222222222222') then raise exception 'Outsider could report'; end if;
end $$;
select 'ok 9 - outsiders still cannot report after a block';
do $$ begin
 delete from public.group_messages where id='e0000010-2222-4222-8222-222222222222';
 if not exists(select 1 from public.reports where message_body='Group words') then raise exception 'Copy lost with message'; end if;
 delete from auth.users where id='e0000002-2222-4222-8222-222222222222';
 if exists(select 1 from public.reports where message_body in ('Group words','Direct words')) then raise exception 'Copy outlived the sender account'; end if;
end $$;
select 'ok 10 - a copy outlives the message but not the sender''s account';
rollback;
