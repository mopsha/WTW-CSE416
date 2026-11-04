-- Real SQL authorization and RLS. Storage HTTP and physical object deletion are
-- separately covered by tests/api/avatars.test.mjs, never inferred from this test.
begin;
select '1..12';
insert into auth.users(id,raw_user_meta_data)
 select ('a733000'||n||'-3333-4333-8333-333333333333')::uuid,jsonb_build_object('display_name','Photo person '||n)
 from generate_series(1,6) n;
insert into public.friendships(requester_id,addressee_id,status,accepted_at) values
 ('a7330001-3333-4333-8333-333333333333','a7330002-3333-4333-8333-333333333333','accepted',now()),
 ('a7330001-3333-4333-8333-333333333333','a7330003-3333-4333-8333-333333333333','pending',null);
insert into public.groups(id,name,owner_id) values
 ('a7330000-3333-4333-8333-333333333333','Photo group','a7330001-3333-4333-8333-333333333333');
insert into public.group_members(group_id,user_id,role) values
 ('a7330000-3333-4333-8333-333333333333','a7330001-3333-4333-8333-333333333333','owner'),
 ('a7330000-3333-4333-8333-333333333333','a7330004-3333-4333-8333-333333333333','member');
insert into public.picks(id,host_id,category,center_lat,center_lng,radius_m) values
 ('a7330000-3333-4333-8333-333333333333','a7330001-3333-4333-8333-333333333333','food',40,-73,1000);
insert into public.pick_participants(pick_id,user_id) values
 ('a7330000-3333-4333-8333-333333333333','a7330001-3333-4333-8333-333333333333'),
 ('a7330000-3333-4333-8333-333333333333','a7330005-3333-4333-8333-333333333333');
insert into storage.objects(bucket_id,name) values
 ('profile-photos','a7330001-3333-4333-8333-333333333333/11111111-1111-4111-8111-111111111111.jpg'),
 ('profile-photos','a7330001-3333-4333-8333-333333333333/22222222-2222-4222-8222-222222222222.jpg');

set local role service_role;
do $$ declare n integer; allowed boolean; begin
 for n in 1..6 loop
  allowed:=private.can_view_avatar(('a733000'||n||'-3333-4333-8333-333333333333')::uuid,'a7330001-3333-4333-8333-333333333333');
  if allowed is distinct from (n in (1,2,4,5)) then raise exception 'Wrong photo visibility for %',n; end if;
 end loop;
 if private.can_view_avatar(null,'a7330001-3333-4333-8333-333333333333') then raise exception 'Null viewer'; end if;
end $$;
select 'ok 1 - owner, accepted friends and current co-members; no pending/stranger access';

do $$ declare r jsonb; begin
 r:=public.avatar_change('a7330001-3333-4333-8333-333333333333',0,'a7330001-3333-4333-8333-333333333333/11111111-1111-4111-8111-111111111111.jpg');
 if r->>'revision'<>'1' or r->'avatarRef'->>'revision'<>'1' then raise exception 'Bad revision'; end if;
 if public.avatar_read('a7330004-3333-4333-8333-333333333333','a7330001-3333-4333-8333-333333333333',1) is null then raise exception 'Group read failed'; end if;
 begin perform public.avatar_change('a7330001-3333-4333-8333-333333333333',0,null); raise exception 'Stale mutation'; exception when sqlstate 'PT409' then null; end;
end $$;
select 'ok 2 - atomic replacement and stale revision conflict';

do $$ begin
 begin perform public.avatar_change('a7330002-3333-4333-8333-333333333333',0,'a7330001-3333-4333-8333-333333333333/11111111-1111-4111-8111-111111111111.jpg'); raise exception 'Foreign prefix accepted'; exception when sqlstate 'PT400' then null; end;
 begin perform public.avatar_change('a7330001-3333-4333-8333-333333333333',1,'a7330001-3333-4333-8333-333333333333/33333333-3333-4333-8333-333333333333.jpg'); raise exception 'Missing object accepted'; exception when sqlstate 'PT400' then null; end;
 if public.avatar_read('a7330001-3333-4333-8333-333333333333','a7330001-3333-4333-8333-333333333333',1) is null then raise exception 'Previous photo lost'; end if;
end $$;
select 'ok 3 - owner prefix and object existence required; failures preserve previous reference';

do $$ declare r jsonb; begin
 r:=public.avatar_refs('a7330004-3333-4333-8333-333333333333',array['a7330001-3333-4333-8333-333333333333']::uuid[]);
 if r->'a7330001-3333-4333-8333-333333333333'->'avatarRef'->>'revision'<>'1' or r::text like '%.jpg%' then raise exception 'Bad reference projection'; end if;
 if public.avatar_refs('a7330003-3333-4333-8333-333333333333',array['a7330001-3333-4333-8333-333333333333']::uuid[])<>'{}'::jsonb then raise exception 'Pending exposed photo'; end if;
end $$;
select 'ok 4 - batch references authorize each target without exposing paths';

insert into public.blocks(blocker_id,blocked_id) values('a7330004-3333-4333-8333-333333333333','a7330001-3333-4333-8333-333333333333');
do $$ begin
 if private.can_view_avatar('a7330004-3333-4333-8333-333333333333','a7330001-3333-4333-8333-333333333333')
 or private.can_view_avatar('a7330001-3333-4333-8333-333333333333','a7330004-3333-4333-8333-333333333333') then raise exception 'Block bypass'; end if;
 begin perform public.avatar_read('a7330004-3333-4333-8333-333333333333','a7330001-3333-4333-8333-333333333333',1); raise exception 'Blocked photo read'; exception when sqlstate 'PT404' then null; end;
end $$;
select 'ok 5 - both block directions override shared-group access';
delete from public.group_members where user_id='a7330004-3333-4333-8333-333333333333';
delete from public.pick_participants where user_id='a7330005-3333-4333-8333-333333333333';
do $$ begin
 if private.can_view_avatar('a7330005-3333-4333-8333-333333333333','a7330001-3333-4333-8333-333333333333') then raise exception 'Former participant access'; end if;
end $$;
select 'ok 6 - participant removal revokes photo access';

do $$ declare n integer; begin
 for n in 1..20 loop perform public.avatar_prepare('a7330001-3333-4333-8333-333333333333',1); end loop;
 begin perform public.avatar_prepare('a7330001-3333-4333-8333-333333333333',1); raise exception 'Upload limit bypass'; exception when sqlstate 'PT429' then null; end;
end $$;
select 'ok 7 - twenty upload attempts per rolling day, independently of message limits';

do $$ declare r jsonb; begin
 r:=public.avatar_change('a7330001-3333-4333-8333-333333333333',1,null);
 if r->>'revision'<>'2' or r->'avatarRef'<>'null'::jsonb then raise exception 'Removal failed'; end if;
 begin perform public.avatar_read('a7330002-3333-4333-8333-333333333333','a7330001-3333-4333-8333-333333333333',1); raise exception 'Removed read'; exception when sqlstate 'PT404' then null; end;
end $$;
select 'ok 8 - remove clears reference, advances revision and revokes old reads';

select public.avatar_begin_account_delete('a7330001-3333-4333-8333-333333333333');
do $$ begin
 begin perform public.avatar_change('a7330001-3333-4333-8333-333333333333',3,null); raise exception 'Deletion write allowed'; exception when sqlstate 'PT409' then null; end;
 if private.can_view_avatar('a7330001-3333-4333-8333-333333333333','a7330002-3333-4333-8333-333333333333') then raise exception 'Deleting viewer allowed'; end if;
end $$;
select 'ok 9 - account-deletion guard invalidates in-flight revisions and denies new writes';
reset role;

-- These manipulate Storage metadata only inside a rolled-back fixture. Production
-- cleanup uses Storage.remove(), never SQL deletes.
update storage.objects set created_at=now()-interval '25 hours' where name like '%11111111-1111-4111-8111-111111111111.jpg';
do $$ begin
 if (select count(*) from public.avatar_orphans())<>1 then raise exception 'Orphan age gate failed'; end if;
 update public.profiles set avatar_path='a7330001-3333-4333-8333-333333333333/11111111-1111-4111-8111-111111111111.jpg' where id='a7330002-3333-4333-8333-333333333333';
 if exists(select 1 from public.avatar_orphans()) then raise exception 'Active object collected'; end if;
end $$;
select 'ok 10 - cleanup excludes recent and active objects';

-- A permissive policy cannot override the bucket-specific restrictive guard.
create policy "test photo permissive" on storage.objects for all to authenticated using(true) with check(true);
set local role authenticated;
select set_config('request.jwt.claim.sub','a7330001-3333-4333-8333-333333333333',true);
do $$ begin
 if exists(select 1 from storage.objects where bucket_id='profile-photos') then raise exception 'Direct photo metadata access'; end if;
 begin insert into storage.objects(bucket_id,name) values('profile-photos','forged'); raise exception 'Direct write'; exception when insufficient_privilege then null; end;
 begin perform public.avatar_change(auth.uid(),3,null); raise exception 'Client mutation RPC'; exception when insufficient_privilege then null; end;
 begin perform avatar_path from public.profiles; raise exception 'Private path column exposed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'ok 11 - restrictive Storage RLS, private columns and service-only mutation grants';
set local role anon;
do $$ begin
 begin perform public.avatar_refs(null,array['a7330001-3333-4333-8333-333333333333']::uuid[]); raise exception 'Anonymous impersonation'; exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
 if (select public from storage.buckets where id='profile-photos') is distinct from false then raise exception 'Bucket public'; end if;
 if (select file_size_limit from storage.buckets where id='profile-photos')<>1048576 then raise exception 'Bucket size'; end if;
end $$;
select 'ok 12 - anonymous access denied and bucket private with bounded size';
rollback;
