-- Generic reports remain available without preserving or granting photo access.
begin;
select '1..3';
insert into auth.users(id,raw_user_meta_data)
 select ('f735000'||n||'-3333-4333-8333-333333333333')::uuid,'{}'::jsonb from generate_series(1,3)n;
insert into public.friendships(requester_id,addressee_id,status,accepted_at) values
 ('f7350001-3333-4333-8333-333333333333','f7350002-3333-4333-8333-333333333333','accepted',now());
insert into public.groups(id,name,owner_id) values
 ('f7350000-3333-4333-8333-333333333333','Former member reports','f7350002-3333-4333-8333-333333333333');
insert into public.group_members(group_id,user_id,role) values
 ('f7350000-3333-4333-8333-333333333333','f7350002-3333-4333-8333-333333333333','owner'),
 ('f7350000-3333-4333-8333-333333333333','f7350003-3333-4333-8333-333333333333','member');
insert into storage.objects(bucket_id,name) values
 ('profile-photos','f7350002-3333-4333-8333-333333333333/11111111-1111-4111-8111-111111111111.jpg');
update public.profiles set avatar_revision=1,avatar_path='f7350002-3333-4333-8333-333333333333/11111111-1111-4111-8111-111111111111.jpg'
 where id='f7350002-3333-4333-8333-333333333333';
set local role service_role;
do $$ begin
 perform public.report_create('f7350001-3333-4333-8333-333333333333','user','f7350002-3333-4333-8333-333333333333','Offensive name or profile picture');
end $$;
select 'ok 1 - accessible peer can submit a generic photo complaint';
do $$ begin
 perform public.block_user('f7350002-3333-4333-8333-333333333333','f7350001-3333-4333-8333-333333333333');
 perform public.report_create('f7350001-3333-4333-8333-333333333333','user','f7350002-3333-4333-8333-333333333333','Offensive name or profile picture');
 perform public.unblock_user('f7350002-3333-4333-8333-333333333333','f7350001-3333-4333-8333-333333333333');
 perform public.block_user('f7350001-3333-4333-8333-333333333333','f7350002-3333-4333-8333-333333333333');
 perform public.report_create('f7350001-3333-4333-8333-333333333333','user','f7350002-3333-4333-8333-333333333333','Offensive name or profile picture');
 begin
  perform public.avatar_read('f7350001-3333-4333-8333-333333333333','f7350002-3333-4333-8333-333333333333',1);
  raise exception 'Generic report restored blocked photo access';
 exception when sqlstate 'PT404' then null;
 end;
end $$;
select 'ok 2 - either block direction preserves generic reporting';
reset role;
delete from public.group_members where group_id='f7350000-3333-4333-8333-333333333333' and user_id='f7350003-3333-4333-8333-333333333333';
set local role service_role;
do $$ begin
 perform public.report_create('f7350003-3333-4333-8333-333333333333','user','f7350002-3333-4333-8333-333333333333','Offensive name or profile picture');
 if (select count(*) from public.reports where reported_user_id='f7350002-3333-4333-8333-333333333333' and target_kind='user')<>4 then raise exception 'Missing fallback reports'; end if;
 if exists(select 1 from public.reports where reported_user_id='f7350002-3333-4333-8333-333333333333' and (photo_path is not null or photo_revision is not null or photo_expires_at is not null)) then raise exception 'Generic report claimed photo evidence'; end if;
 begin
  perform public.avatar_report_create('f7350003-3333-4333-8333-333333333333','f7350002-3333-4333-8333-333333333333',1,'Not authorized');
  raise exception 'Former member bypassed photo authorization';
 exception when sqlstate 'PT404' then null;
 end;
end $$;
select 'ok 3 - removed member can report the user but cannot pin private photo evidence';
rollback;
