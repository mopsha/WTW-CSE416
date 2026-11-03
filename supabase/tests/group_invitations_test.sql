-- Standalone TAP against real RLS/RPCs. Direct requests differ from bearer-link acceptance.
begin;
select '1..12';
insert into auth.users(id,raw_user_meta_data) select
 ('f'||lpad(n::text,7,'0')||'-1111-4111-8111-111111111111')::uuid,'{}'::jsonb from generate_series(1,30)n;
insert into public.friendships(requester_id,addressee_id,status,accepted_at) select
 'f0000001-1111-4111-8111-111111111111',('f'||lpad(n::text,7,'0')||'-1111-4111-8111-111111111111')::uuid,'accepted',now() from unnest(array[2,3,6,7])n;
insert into public.groups(id,name,owner_id) values('f0000000-1111-4111-8111-111111111111','The crew','f0000001-1111-4111-8111-111111111111');
insert into public.group_members(group_id,user_id,role) values
 ('f0000000-1111-4111-8111-111111111111','f0000001-1111-4111-8111-111111111111','owner'),
 ('f0000000-1111-4111-8111-111111111111','f0000003-1111-4111-8111-111111111111','member');
create temporary table gi_test(k text primary key,id uuid) on commit drop;
grant all on gi_test to service_role;
set local role service_role;
do $$ declare n integer; begin
 n:=public.group_add_members('f0000001-1111-4111-8111-111111111111','f0000000-1111-4111-8111-111111111111',array['f0000002-1111-4111-8111-111111111111','f0000006-1111-4111-8111-111111111111','f0000002-1111-4111-8111-111111111111']::uuid[]);
 if n<>2 or (select count(*) from public.group_members where group_id='f0000000-1111-4111-8111-111111111111')<>2 then raise exception 'Invitation added members'; end if;
 if public.group_add_members('f0000001-1111-4111-8111-111111111111','f0000000-1111-4111-8111-111111111111',array['f0000002-1111-4111-8111-111111111111','f0000003-1111-4111-8111-111111111111']::uuid[])<>0 then raise exception 'Duplicate request'; end if;
end $$;
insert into gi_test select 'accept',id from public.group_invitations where invitee_id='f0000002-1111-4111-8111-111111111111';
insert into gi_test select 'decline',id from public.group_invitations where invitee_id='f0000006-1111-4111-8111-111111111111';
select 'ok 1 - direct invitations are pending, duplicate/member sends are no-ops';
do $$ begin
 begin perform public.group_add_members('f0000001-1111-4111-8111-111111111111','f0000000-1111-4111-8111-111111111111',array['f0000004-1111-4111-8111-111111111111']::uuid[]); raise exception 'Invited stranger'; exception when sqlstate 'PT403' then null; end;
 begin perform public.group_add_members('f0000003-1111-4111-8111-111111111111','f0000000-1111-4111-8111-111111111111',array['f0000002-1111-4111-8111-111111111111']::uuid[]); raise exception 'Nonowner invited'; exception when sqlstate 'PT403' then null; end;
 begin perform public.group_add_members('f0000004-1111-4111-8111-111111111111','f0000000-1111-4111-8111-111111111111',array['f0000002-1111-4111-8111-111111111111']::uuid[]); raise exception 'Outsider invited'; exception when sqlstate 'PT404' then null; end;
end $$;
select 'ok 2 - owner-only accepted-friend invitation permission retained';
do $$ declare r jsonb; begin
 r:=public.group_invitations_list('f0000002-1111-4111-8111-111111111111');
 if jsonb_array_length(r)<>1 or r->0->>'groupName'<>'The crew' then raise exception 'Wrong recipient list'; end if;
 if public.group_invitations_list('f0000004-1111-4111-8111-111111111111')<>'[]' then raise exception 'Outsider sees invites'; end if;
 if jsonb_array_length(public.group_invitations_list('f0000001-1111-4111-8111-111111111111','f0000000-1111-4111-8111-111111111111'))<>2 then raise exception 'Owner list missing'; end if;
 begin perform public.group_invitations_list('f0000003-1111-4111-8111-111111111111','f0000000-1111-4111-8111-111111111111'); raise exception 'Member sees outgoing invites'; exception when sqlstate 'PT403' then null; end;
end $$;
select 'ok 3 - recipient sees only own requests; owner sees pending; other members cannot inspect';
do $$ declare n integer; begin
 select count(*) into n from public.notify_insert(array['f0000002-1111-4111-8111-111111111111']::uuid[],'group_invite',null,jsonb_build_object('inviteId',(select id from gi_test where k='accept')));
 if n<>1 then raise exception 'First notice not inserted'; end if;
 select count(*) into n from public.notify_insert(array['f0000002-1111-4111-8111-111111111111']::uuid[],'group_invite',null,jsonb_build_object('inviteId',(select id from gi_test where k='accept')));
 if n<>0 then raise exception 'Duplicate notification'; end if;
 select count(*) into n from public.notify_insert(array['f0000004-1111-4111-8111-111111111111']::uuid[],'group_invite',null,jsonb_build_object('inviteId',(select id from gi_test where k='accept')));
 if n<>0 then raise exception 'Notice sent to wrong user'; end if;
end $$;
select 'ok 4 - existing notifier insert path deduplicates each invite and restricts recipient';
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','f0000002-1111-4111-8111-111111111111',true);
do $$ begin
 if (select count(*) from public.group_invitations)<>1 or exists(select 1 from public.groups) then raise exception 'RLS leaked group or other invites'; end if;
 begin insert into public.group_invitations(group_id,inviter_id,invitee_id) values('f0000000-1111-4111-8111-111111111111','f0000001-1111-4111-8111-111111111111',auth.uid()); raise exception 'Client write allowed'; exception when insufficient_privilege then null; end;
 begin perform public.group_invitation_resolve(auth.uid(),gen_random_uuid(),'accepted'); raise exception 'Client called service RPC'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','f0000004-1111-4111-8111-111111111111',true);
do $$ begin if exists(select 1 from public.group_invitations) then raise exception 'Outsider RLS leaked'; end if; end $$;
reset role;
set local role service_role;
select 'ok 5 - RLS exposes only relevant invitations; invitation is not group access; client writes denied';
do $$ declare r jsonb; begin
 begin perform public.group_invitation_resolve('f0000001-1111-4111-8111-111111111111',(select id from gi_test where k='accept'),'accepted'); raise exception 'Inviter resolved'; exception when sqlstate 'PT404' then null; end;
 begin perform public.group_invitation_resolve('f0000004-1111-4111-8111-111111111111',(select id from gi_test where k='accept'),'accepted'); raise exception 'Wrong user resolved'; exception when sqlstate 'PT404' then null; end;
 r:=public.group_invitation_resolve('f0000006-1111-4111-8111-111111111111',(select id from gi_test where k='decline'),'declined');
 if r->>'status'<>'declined' or r->>'resolvedAt' is null or exists(select 1 from public.group_members where user_id='f0000006-1111-4111-8111-111111111111') then raise exception 'Decline created membership'; end if;
 if public.group_invitation_resolve('f0000006-1111-4111-8111-111111111111',(select id from gi_test where k='decline'),'declined') is distinct from r then raise exception 'Decline retry changed result'; end if;
 begin perform public.group_invitation_resolve('f0000006-1111-4111-8111-111111111111',(select id from gi_test where k='decline'),'accepted'); raise exception 'Declined reused'; exception when sqlstate 'PT409' then null; end;
end $$;
select 'ok 6 - recipient-only decline closes request, no member, safe retry, no opposite reuse';
do $$ declare r jsonb; begin
 r:=public.group_invitation_resolve('f0000002-1111-4111-8111-111111111111',(select id from gi_test where k='accept'),'accepted');
 if r->>'status'<>'accepted' or r->>'resolvedAt' is null or (select count(*) from public.group_members where user_id='f0000002-1111-4111-8111-111111111111')<>1 then raise exception 'Accept did not add exactly recipient'; end if;
 if public.group_invitation_resolve('f0000002-1111-4111-8111-111111111111',(select id from gi_test where k='accept'),'accepted') is distinct from r then raise exception 'Accept retry changed result'; end if;
 if exists(select 1 from public.notifications where type='group_invite' and read_at is null) then raise exception 'Notice not marked read'; end if;
 perform public.group_remove_member('f0000001-1111-4111-8111-111111111111','f0000000-1111-4111-8111-111111111111','f0000002-1111-4111-8111-111111111111');
 begin perform public.group_invitation_resolve('f0000002-1111-4111-8111-111111111111',(select id from gi_test where k='accept'),'accepted'); raise exception 'Old accepted invite re-added member'; exception when sqlstate 'PT409' then null; end;
end $$;
select 'ok 7 - accept adds authenticated recipient once and cannot re-add a removed member';
select public.group_add_members('f0000001-1111-4111-8111-111111111111','f0000000-1111-4111-8111-111111111111',array['f0000002-1111-4111-8111-111111111111','f0000006-1111-4111-8111-111111111111']::uuid[]);
select public.block_user('f0000006-1111-4111-8111-111111111111','f0000001-1111-4111-8111-111111111111');
select public.friend_remove('f0000001-1111-4111-8111-111111111111','f0000002-1111-4111-8111-111111111111');
do $$ declare u uuid; begin
 foreach u in array array['f0000002-1111-4111-8111-111111111111','f0000006-1111-4111-8111-111111111111']::uuid[] loop
 if public.group_invitations_list(u)<>'[]' then raise exception 'Invalid relationship visible'; end if;
 begin perform public.group_invitation_resolve(u,(select id from public.group_invitations where invitee_id=u and status='pending'),'accepted'); raise exception 'Invalid relationship accepted'; exception when sqlstate 'PT404' then null; end;
 end loop;
end $$;
select 'ok 8 - reverse blocks and friendship removal hide requests and prevent acceptance';
-- Existing bearer-link acceptance is still an explicit consent path, with original caps.
do $$ declare r jsonb; token text; begin
 token:=public.invite_create('f0000001-1111-4111-8111-111111111111','group','f0000000-1111-4111-8111-111111111111',1)->>'token';
 r:=public.invite_accept(token,'f0000007-1111-4111-8111-111111111111');
 if r->>'ok'<>'true' or not exists(select 1 from public.group_members where user_id='f0000007-1111-4111-8111-111111111111') then raise exception 'Link acceptance regressed'; end if;
 perform public.group_remove_member('f0000001-1111-4111-8111-111111111111','f0000000-1111-4111-8111-111111111111','f0000007-1111-4111-8111-111111111111');
end $$;
select 'ok 9 - bearer-link explicit acceptance remains compatible';
select public.group_add_members('f0000001-1111-4111-8111-111111111111','f0000000-1111-4111-8111-111111111111',array['f0000007-1111-4111-8111-111111111111']::uuid[]);
reset role;
insert into public.group_members(group_id,user_id) select 'f0000000-1111-4111-8111-111111111111',('f'||lpad(n::text,7,'0')||'-1111-4111-8111-111111111111')::uuid from generate_series(8,30)n;
set local role service_role;
do $$ declare i uuid:=(select id from public.group_invitations where invitee_id='f0000007-1111-4111-8111-111111111111' and status='pending'); begin
 begin perform public.group_invitation_resolve('f0000007-1111-4111-8111-111111111111',i,'accepted'); raise exception 'Overfilled group'; exception when sqlstate 'PT409' then null; end;
 if (select status from public.group_invitations where id=i)<>'pending' then raise exception 'Full group consumed request'; end if;
 if public.group_add_members('f0000001-1111-4111-8111-111111111111','f0000000-1111-4111-8111-111111111111',array['f0000007-1111-4111-8111-111111111111']::uuid[])<>0 then raise exception 'Full-group retry duplicate'; end if;
 perform public.group_remove_member('f0000001-1111-4111-8111-111111111111','f0000000-1111-4111-8111-111111111111','f0000008-1111-4111-8111-111111111111');
 perform public.group_invitation_resolve('f0000007-1111-4111-8111-111111111111',i,'accepted');
 if (select count(*) from public.group_members where group_id='f0000000-1111-4111-8111-111111111111')<>25 then raise exception 'Wrong capacity'; end if;
end $$;
select 'ok 10 - accept enforces capacity atomically; pending retry survives and succeeds when room opens';
reset role;
delete from auth.users where id='f0000007-1111-4111-8111-111111111111';
do $$ begin if exists(select 1 from public.group_invitations where invitee_id='f0000007-1111-4111-8111-111111111111') then raise exception 'Recipient deletion leaked invitation'; end if; end $$;
select 'ok 11 - recipient account deletion cascades invitations';
delete from auth.users where id='f0000001-1111-4111-8111-111111111111';
do $$ begin if exists(select 1 from public.group_invitations where group_id='f0000000-1111-4111-8111-111111111111') or exists(select 1 from public.groups where id='f0000000-1111-4111-8111-111111111111') then raise exception 'Inviter/group deletion retained invitations'; end if; end $$;
select 'ok 12 - inviter/group deletion cascades pending and resolved invitations';
rollback;
