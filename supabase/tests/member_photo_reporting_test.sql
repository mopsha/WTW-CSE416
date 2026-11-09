-- Group-menu payload -> existing photo report -> operator review/removal.
-- Synthetic Storage metadata and moderation settings are ROLLED-BACK FIXTURES,
-- never operational configuration, upload enablement or a retention deployment.
begin;
select '1..7';
insert into auth.users(id,raw_user_meta_data)
 select ('a736000'||n||'-3333-4333-8333-333333333333')::uuid,'{}'::jsonb from generate_series(1,3)n;
insert into public.groups(id,name,owner_id) values
 ('a7360000-3333-4333-8333-333333333333','Photo report fixture','a7360001-3333-4333-8333-333333333333');
insert into public.group_members(group_id,user_id,role) values
 ('a7360000-3333-4333-8333-333333333333','a7360001-3333-4333-8333-333333333333','owner'),
 ('a7360000-3333-4333-8333-333333333333','a7360002-3333-4333-8333-333333333333','member');
insert into storage.objects(bucket_id,name) values
 ('profile-photos','a7360001-3333-4333-8333-333333333333/11111111-1111-4111-8111-111111111111.jpg'),
 ('profile-photos','a7360001-3333-4333-8333-333333333333/22222222-2222-4222-8222-222222222222.jpg');
update public.profiles set avatar_revision=1,avatar_path='a7360001-3333-4333-8333-333333333333/11111111-1111-4111-8111-111111111111.jpg'
 where id='a7360001-3333-4333-8333-333333333333';
-- Approved 30-day duration is asserted in a temporary fixture only.
update private.photo_moderation_config set retention_seconds=2592000,moderation_ready=true;
set local role service_role;
do $$ declare rid uuid; begin
 rid:=public.report_create('a7360002-3333-4333-8333-333333333333','user','a7360001-3333-4333-8333-333333333333','Offensive name');
 if not exists(select from public.reports where id=rid and target_kind='user'
   and photo_revision is null and photo_path is null and photo_expires_at is null) then raise exception 'Generic report claimed photo evidence'; end if;
 begin perform public.avatar_moderation_current(rid); raise exception 'Generic user report entered photo moderation';
 exception when sqlstate 'PT404' then null; end;
end $$;
select 'ok 1 - user report remains separate and is never represented as photo evidence';

do $$ declare rid uuid; again uuid; begin
 rid:=public.avatar_report_create('a7360002-3333-4333-8333-333333333333','a7360001-3333-4333-8333-333333333333',1,'Hate speech or threats');
 again:=public.avatar_report_create('a7360002-3333-4333-8333-333333333333','a7360001-3333-4333-8333-333333333333',1,'Spam');
 if rid<>again or not exists(select from public.reports where id=rid and target_kind='profile_photo'
  and photo_revision=1 and photo_path is not null
  and abs(extract(epoch from (photo_expires_at-clock_timestamp()))-2592000)<10) then raise exception 'Evidence/revision/retention mismatch'; end if;
 if (select count(*) from public.rate_limit_events where user_id='a7360002-3333-4333-8333-333333333333' and action='report')<>2 then raise exception 'Duplicate consumed quota'; end if;
 if (public.avatar_moderation_current(rid)->>'revision')::bigint<>1 then raise exception 'Group member report not actionable'; end if;
end $$;
select 'ok 2 - group-only member pins exact revision once with private 30-day evidence';

-- Regression for the real HTTP fixture: a reverse block must be removed before
-- reusing the same shared-group peer in a positive current-photo report case.
do $$ declare rid uuid; after_unblock uuid; begin
 select id into rid from public.reports where target_kind='profile_photo' and photo_revision=1 and reporter_id='a7360002-3333-4333-8333-333333333333';
 perform public.block_user('a7360001-3333-4333-8333-333333333333','a7360002-3333-4333-8333-333333333333');
 if (select count(*) from public.group_members where group_id='a7360000-3333-4333-8333-333333333333')<>2 then
  raise exception 'Shared-group fixture changed'; end if;
 begin
  perform public.avatar_report_create('a7360002-3333-4333-8333-333333333333','a7360001-3333-4333-8333-333333333333',1,'Blocked current photo');
  raise exception 'Shared group overrode reverse block';
 exception when sqlstate 'PT404' then
  if sqlerrm<>'Nothing to report here' then raise; end if;
 end;
 perform public.unblock_user('a7360001-3333-4333-8333-333333333333','a7360002-3333-4333-8333-333333333333');
 if public.avatar_read('a7360002-3333-4333-8333-333333333333','a7360001-3333-4333-8333-333333333333',1) is null then
  raise exception 'Photo visibility not restored'; end if;
 after_unblock:=public.avatar_report_create('a7360002-3333-4333-8333-333333333333','a7360001-3333-4333-8333-333333333333',1,'Visible current photo');
 if after_unblock<>rid then raise exception 'Unblocking bypassed report deduplication'; end if;
 if (select count(*) from public.rate_limit_events where user_id='a7360002-3333-4333-8333-333333333333' and action='report')<>2 then
  raise exception 'Blocked or duplicate report consumed quota'; end if;
end $$;
select 'ok 3 - reverse block denies reports until cleanup; same group then regains authorized reporting';

do $$ declare rid uuid; begin
 select id into rid from public.reports where target_kind='profile_photo' and photo_revision=1 and reporter_id='a7360002-3333-4333-8333-333333333333';
 perform public.avatar_change('a7360001-3333-4333-8333-333333333333',1,'a7360001-3333-4333-8333-333333333333/22222222-2222-4222-8222-222222222222.jpg');
 begin perform public.avatar_report_create('a7360002-3333-4333-8333-333333333333','a7360001-3333-4333-8333-333333333333',1,'Stale');
 raise exception 'Stale revision reported'; exception when sqlstate 'PT404' then null; end;
 begin perform public.avatar_moderation_current(rid); raise exception 'Replaced photo accepted as current';
 exception when sqlstate 'PT409' then null; end;
 begin perform public.avatar_moderation_remove(rid); raise exception 'Old evidence removed replacement';
 exception when sqlstate 'PT409' then null; end;
 perform public.avatar_report_create('a7360002-3333-4333-8333-333333333333','a7360001-3333-4333-8333-333333333333',2,'Sexual or violent content');
end $$;
select 'ok 4 - replaced revision cannot be newly reported or remove its replacement';

do $$ begin
 perform public.block_user('a7360002-3333-4333-8333-333333333333','a7360001-3333-4333-8333-333333333333');
 perform public.report_create('a7360002-3333-4333-8333-333333333333','user','a7360001-3333-4333-8333-333333333333','Harassment or bullying');
 begin perform public.avatar_report_create('a7360002-3333-4333-8333-333333333333','a7360001-3333-4333-8333-333333333333',2,'Blocked photo');
 raise exception 'Block bypassed photo authorization'; exception when sqlstate 'PT404' then null; end;
 begin perform public.avatar_report_create('a7360003-3333-4333-8333-333333333333','a7360001-3333-4333-8333-333333333333',2,'Stranger photo');
 raise exception 'Stranger report allowed'; exception when sqlstate 'PT404' then null; end;
end $$;
select 'ok 5 - blocked generic reports remain usable; private photo access stays denied';

do $$ declare rid uuid; current_photo jsonb; removed jsonb; begin
 select id into rid from public.reports where target_kind='profile_photo' and photo_revision=2 and reporter_id='a7360002-3333-4333-8333-333333333333';
 current_photo:=public.avatar_moderation_current(rid);
 removed:=public.avatar_moderation_remove_current(rid,(current_photo->>'revision')::bigint,current_photo->>'path');
 if removed->>'sourceReportId'<>rid::text or not exists(select from public.profiles where id='a7360001-3333-4333-8333-333333333333' and avatar_path is null and avatar_revision=3)
  or not exists(select from public.reports where id=rid and reviewed_at is not null and review_note like '%Removed reported current photo revision 2%' and photo_path is not null) then
  raise exception 'Removal/audit/private evidence failed'; end if;
 if exists(select from public.reports where target_kind='user' and reviewed_at is not null and reported_user_id='a7360001-3333-4333-8333-333333333333') then
  raise exception 'Photo moderation altered generic user reports'; end if;
 begin perform public.avatar_moderation_current(rid); raise exception 'Deleted photo shown as current';
 exception when sqlstate 'PT409' then null; end;
end $$;
select 'ok 6 - current-photo removal accepts member report, records audit, preserves pinned evidence';

reset role;
do $$ begin
 if has_function_privilege('authenticated','public.avatar_moderation_current(uuid)','execute')
 or has_function_privilege('authenticated','public.avatar_moderation_remove_current(uuid,bigint,text)','execute')
 or has_table_privilege('authenticated','public.reports','select') then raise exception 'Moderation privacy bypass'; end if;
end $$;
select 'ok 7 - mobile users cannot read reports or invoke operator moderation';
rollback;
