-- Actual SQL/RLS, rolled-back fixtures; no real Storage bytes are created here.
begin;
select '1..10';
insert into auth.users(id,raw_user_meta_data)
 select ('d735000'||n||'-3333-4333-8333-333333333333')::uuid,'{}'::jsonb from generate_series(1,5)n;
insert into public.friendships(requester_id,addressee_id,status,accepted_at) values
 ('d7350001-3333-4333-8333-333333333333','d7350002-3333-4333-8333-333333333333','accepted',now()),
 ('d7350001-3333-4333-8333-333333333333','d7350003-3333-4333-8333-333333333333','accepted',now());
insert into storage.objects(bucket_id,name) values
 ('profile-photos','d7350001-3333-4333-8333-333333333333/11111111-1111-4111-8111-111111111111.jpg'),
 ('profile-photos','d7350001-3333-4333-8333-333333333333/22222222-2222-4222-8222-222222222222.jpg');
update public.profiles set avatar_revision=1,avatar_path='d7350001-3333-4333-8333-333333333333/11111111-1111-4111-8111-111111111111.jpg' where id='d7350001-3333-4333-8333-333333333333';
update private.photo_moderation_config set retention_seconds=3600,moderation_ready=false; -- Fixture, not policy.
set local role service_role;
do $$ begin
 if public.avatar_capabilities()<> '{"uploadsEnabled":false,"reportsEnabled":false}'::jsonb then raise exception 'Retention alone enabled moderation'; end if;
 begin perform public.avatar_prepare('d7350002-3333-4333-8333-333333333333',0); raise exception 'Initial upload bypassed gate'; exception when sqlstate 'PT503' then null; end;
 begin perform public.avatar_prepare('d7350001-3333-4333-8333-333333333333',1); raise exception 'Replacement bypassed gate'; exception when sqlstate 'PT503' then null; end;
 begin perform public.avatar_change('d7350001-3333-4333-8333-333333333333',1,'d7350001-3333-4333-8333-333333333333/22222222-2222-4222-8222-222222222222.jpg'); raise exception 'Finalize bypassed gate'; exception when sqlstate 'PT503' then null; end;
 if exists(select 1 from public.rate_limit_events where user_id='d7350001-3333-4333-8333-333333333333' and action='avatar_upload') then raise exception 'Disabled upload spent quota'; end if;
end $$;
select 'ok 1 - initial upload, replacement and stale in-flight finalization fail closed without explicit readiness';
do $$ begin
 if public.avatar_read('d7350002-3333-4333-8333-333333333333','d7350001-3333-4333-8333-333333333333',1) is null then raise exception 'Read disabled'; end if;
 perform public.avatar_change('d7350001-3333-4333-8333-333333333333',1,null);
 if not exists(select 1 from public.profiles where id='d7350001-3333-4333-8333-333333333333' and avatar_path is null and avatar_revision=2) then raise exception 'Owner removal disabled'; end if;
end $$;
select 'ok 2 - existing reads and owner removal remain available while uploads are disabled';
reset role;
update private.photo_moderation_config set moderation_ready=true;
set local role service_role;
do $$ begin
 if public.avatar_capabilities()<> '{"uploadsEnabled":true,"reportsEnabled":true}'::jsonb then raise exception 'Enabled capability mismatch'; end if;
 perform public.avatar_prepare('d7350001-3333-4333-8333-333333333333',2);
 perform public.avatar_change('d7350001-3333-4333-8333-333333333333',2,'d7350001-3333-4333-8333-333333333333/11111111-1111-4111-8111-111111111111.jpg');
 perform public.avatar_report_create('d7350002-3333-4333-8333-333333333333','d7350001-3333-4333-8333-333333333333',3,'First');
 perform public.avatar_report_create('d7350003-3333-4333-8333-333333333333','d7350001-3333-4333-8333-333333333333',3,'Second');
 perform public.avatar_change('d7350001-3333-4333-8333-333333333333',3,'d7350001-3333-4333-8333-333333333333/22222222-2222-4222-8222-222222222222.jpg');
end $$;
select 'ok 3 - explicit readiness supports upload/report paths while preserving immutable prior reports';
do $$ declare rid uuid; begin
 select id into rid from public.reports where target_kind='profile_photo' and reporter_id='d7350002-3333-4333-8333-333333333333' and photo_revision=3;
 begin perform public.avatar_moderation_current(rid); raise exception 'Old report exposed newer current photo'; exception when sqlstate 'PT409' then null; end;
 begin perform public.avatar_moderation_remove_current(rid,3,'d7350001-3333-4333-8333-333333333333/11111111-1111-4111-8111-111111111111.jpg'); raise exception 'Stale removal accepted'; exception when sqlstate 'PT409' then null; end;
 perform public.avatar_report_create('d7350002-3333-4333-8333-333333333333','d7350001-3333-4333-8333-333333333333',4,'First current');
 perform public.avatar_report_create('d7350003-3333-4333-8333-333333333333','d7350001-3333-4333-8333-333333333333',4,'Second current');
end $$;
select 'ok 4 - moderator current verification cannot inspect or remove a replacement through a stale report';
reset role;
update public.reports set photo_expires_at=clock_timestamp()-interval '1 second',review_note='Preserve this note',reviewed_at=now()-interval '1 day' where photo_revision=4;
update private.photo_moderation_config set moderation_ready=false;
set local role service_role;
do $$ declare rid uuid; current_photo jsonb; begin
 select id into rid from public.reports where reporter_id='d7350002-3333-4333-8333-333333333333' and photo_revision=4;
 perform public.avatar_expire_evidence();
 begin perform public.avatar_moderation_evidence(rid); raise exception 'Expired historical evidence exposed'; exception when sqlstate 'PT404' then null; end;
 current_photo:=public.avatar_moderation_current(rid);
 if current_photo->>'revision'<>'4' or current_photo->>'path' is distinct from 'd7350001-3333-4333-8333-333333333333/22222222-2222-4222-8222-222222222222.jpg' then raise exception 'Wrong current verification'; end if;
 if exists(select 1 from public.reports where photo_revision=4 and photo_path is not null) then raise exception 'Current verification restored historical evidence'; end if;
 begin perform public.avatar_moderation_remove_current(rid,4,'wrong-path'); raise exception 'Wrong expected path removed photo'; exception when sqlstate 'PT409' then null; end;
end $$;
select 'ok 5 - privileged current review works independently of expired evidence and never repins historical data';
do $$ declare rid uuid; result jsonb; begin
 select id into rid from public.reports where reporter_id='d7350002-3333-4333-8333-333333333333' and photo_revision=4;
 result:=public.avatar_moderation_remove_current(rid,4,'d7350001-3333-4333-8333-333333333333/22222222-2222-4222-8222-222222222222.jpg');
 if (result->>'resolvedReports')::int<>2 then raise exception 'Not all exact-revision reports resolved'; end if;
 if (select count(*) from public.reports where photo_revision=4 and review_note like 'Preserve this note%' and review_note like '%source report '||rid||'%' and reviewed_at=now()-interval '1 day')<>2 then raise exception 'Review notes or dates overwritten'; end if;
 if exists(select 1 from public.reports where photo_revision=3 and reviewed_at is not null) then raise exception 'Unrelated revision resolved'; end if;
 if not exists(select 1 from public.profiles where id='d7350001-3333-4333-8333-333333333333' and avatar_revision=5 and avatar_path is null) then raise exception 'Removal did not advance revision'; end if;
end $$;
select 'ok 6 - current removal resolves all matching reports, preserves notes and leaves unrelated revisions untouched';
reset role;
update private.photo_moderation_config set moderation_ready=true;
insert into public.groups(id,name,owner_id) values('d7350000-3333-4333-8333-333333333333','Photo report group','d7350001-3333-4333-8333-333333333333');
insert into public.group_members(group_id,user_id,role) values
 ('d7350000-3333-4333-8333-333333333333','d7350001-3333-4333-8333-333333333333','owner'),
 ('d7350000-3333-4333-8333-333333333333','d7350004-3333-4333-8333-333333333333','member');
insert into public.picks(id,host_id,category,center_lat,center_lng,radius_m) values
 ('d7350000-3333-4333-8333-333333333333','d7350001-3333-4333-8333-333333333333','food',40,-73,1000);
insert into public.pick_participants(pick_id,user_id) values
 ('d7350000-3333-4333-8333-333333333333','d7350001-3333-4333-8333-333333333333'),
 ('d7350000-3333-4333-8333-333333333333','d7350005-3333-4333-8333-333333333333');
set local role service_role;
do $$ begin
 perform public.avatar_change('d7350001-3333-4333-8333-333333333333',5,'d7350001-3333-4333-8333-333333333333/22222222-2222-4222-8222-222222222222.jpg');
end $$;
do $$ begin
 perform public.avatar_report_create('d7350004-3333-4333-8333-333333333333','d7350001-3333-4333-8333-333333333333',6,'Group photo');
 perform public.avatar_report_create('d7350005-3333-4333-8333-333333333333','d7350001-3333-4333-8333-333333333333',6,'Pick photo');
end $$;
select 'ok 7 - current group and active Pick participants report photos without friendship or broader profile access';
reset role;
delete from public.group_members where group_id='d7350000-3333-4333-8333-333333333333' and user_id='d7350004-3333-4333-8333-333333333333';
insert into public.blocks(blocker_id,blocked_id) values('d7350001-3333-4333-8333-333333333333','d7350005-3333-4333-8333-333333333333');
set local role service_role;
do $$ begin
 begin perform public.avatar_report_create('d7350004-3333-4333-8333-333333333333','d7350001-3333-4333-8333-333333333333',6,'After removal'); raise exception 'Removal bypass without trusted receipt'; exception when sqlstate 'PT404' then null; end;
 begin perform public.avatar_report_create('d7350005-3333-4333-8333-333333333333','d7350001-3333-4333-8333-333333333333',6,'After block'); raise exception 'Block bypass without trusted receipt'; exception when sqlstate 'PT404' then null; end;
end $$;
select 'ok 8 - revocation still rejects new submissions until a bounded receipt policy is approved';
reset role;
update private.photo_moderation_config set moderation_ready=false;
set local role service_role;
do $$ begin
 perform public.report_create('d7350002-3333-4333-8333-333333333333','user','d7350001-3333-4333-8333-333333333333','Offensive name');
 perform public.avatar_begin_account_delete('d7350001-3333-4333-8333-333333333333');
end $$;
select 'ok 9 - ordinary user reporting and account-deletion intent remain available while moderation is paused';
reset role;
do $$ begin
 if has_function_privilege('authenticated','public.avatar_moderation_current(uuid)','execute')
 or has_function_privilege('authenticated','public.avatar_moderation_remove_current(uuid,bigint,text)','execute')
 or has_function_privilege('anon','public.avatar_capabilities(uuid)','execute')
 then raise exception 'Privileged RPC exposed directly'; end if;
end $$;
update private.photo_moderation_config set moderation_ready=true;
do $$ begin
 if (public.avatar_capabilities('d7350001-3333-4333-8333-333333333333')->>'uploadsEnabled')::boolean then raise exception 'Deletion-pending account enabled'; end if;
 if not (public.avatar_capabilities('d7350002-3333-4333-8333-333333333333')->>'uploadsEnabled')::boolean then raise exception 'Other account disabled'; end if;
end $$;
set local role service_role;
do $$ begin
 begin update private.photo_moderation_config set moderation_ready=false; raise exception 'Service can approve readiness'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'ok 10 - normal users cannot inspect current moderation photos or remove them';
rollback;
