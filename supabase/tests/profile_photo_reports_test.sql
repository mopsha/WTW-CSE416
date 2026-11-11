-- PostgreSQL/RLS tests. Synthetic Storage metadata rolls back; not a Storage HTTP test.
begin;
select '1..12';
insert into auth.users(id,raw_user_meta_data)
 select ('b735000'||n||'-3333-4333-8333-333333333333')::uuid,jsonb_build_object('display_name','Report person '||n)
 from generate_series(1,4)n;
insert into public.friendships(requester_id,addressee_id,status,accepted_at) values
 ('b7350001-3333-4333-8333-333333333333','b7350002-3333-4333-8333-333333333333','accepted',now());
insert into storage.objects(bucket_id,name,created_at) values
 ('profile-photos','b7350001-3333-4333-8333-333333333333/11111111-1111-4111-8111-111111111111.jpg',now()-interval '2 days'),
 ('profile-photos','b7350001-3333-4333-8333-333333333333/22222222-2222-4222-8222-222222222222.jpg',now());
update public.profiles set avatar_revision=1,avatar_path='b7350001-3333-4333-8333-333333333333/11111111-1111-4111-8111-111111111111.jpg'
 where id='b7350001-3333-4333-8333-333333333333';
create function pg_temp.photo_denied(who uuid,revision bigint) returns boolean language plpgsql as $$ begin
 perform public.avatar_report_create(who,'b7350001-3333-4333-8333-333333333333',revision,'Abuse');
 return false;
 exception when sqlstate 'PT404' then return true;
end $$;
set local role service_role;
do $$ begin
 begin
  perform public.avatar_report_create('b7350002-3333-4333-8333-333333333333','b7350001-3333-4333-8333-333333333333',1,'Abuse');
  raise exception 'Unconfigured reporting enabled';
 exception when sqlstate 'PT503' then null; end;
end $$;
select 'ok 1 - no default evidence retention or implicit enablement';
reset role;
-- Test fixture ONLY: this is not a recommended production retention period.
update private.photo_moderation_config set retention_seconds=3600,moderation_ready=true;
set local role service_role;
do $$ declare first_id uuid; second_id uuid; deadline timestamptz; begin
 first_id:=public.avatar_report_create('b7350002-3333-4333-8333-333333333333','b7350001-3333-4333-8333-333333333333',1,'Abuse');
 select photo_expires_at into deadline from public.reports where id=first_id;
 second_id:=public.avatar_report_create('b7350002-3333-4333-8333-333333333333','b7350001-3333-4333-8333-333333333333',1,'Again');
 if first_id<>second_id or not exists(select 1 from public.reports where id=first_id
  and photo_revision=1 and photo_path like '%111111111111.jpg' and photo_expires_at=deadline)
 then raise exception 'Photo evidence not bound or duplicate created'; end if;
 if (select count(*) from public.rate_limit_events where user_id='b7350002-3333-4333-8333-333333333333' and action='report')<>1
 then raise exception 'Duplicate charged again'; end if;
end $$;
select 'ok 2 - accepted friend reports exact revision once using shared report quota';
-- Keep this same revision current while testing expired duplicate submissions.
reset role;
update public.reports set photo_expires_at=clock_timestamp()-interval '1 second'
 where target_kind='profile_photo' and target_id='b7350001-3333-4333-8333-333333333333';
set local role service_role;
do $$ begin
 begin
  perform public.avatar_report_create('b7350002-3333-4333-8333-333333333333','b7350001-3333-4333-8333-333333333333',1,'Again');
  raise exception 'Expired report falsely succeeded';
 exception when sqlstate 'PT409' then null; end;
 perform public.avatar_expire_evidence();
 begin
  perform public.avatar_report_create('b7350002-3333-4333-8333-333333333333','b7350001-3333-4333-8333-333333333333',1,'Again');
  raise exception 'Cleaned report falsely succeeded';
 exception when sqlstate 'PT409' then null; end;
 if not pg_temp.photo_denied('b7350003-3333-4333-8333-333333333333',1)
 or not pg_temp.photo_denied('b7350002-3333-4333-8333-333333333333',0)
 then raise exception 'Expired state leaked to unauthorized/stale caller'; end if;
 if (select count(*) from public.rate_limit_events where user_id='b7350002-3333-4333-8333-333333333333' and action='report')<>1
 then raise exception 'Expired report charged quota'; end if;
end $$;
select 'ok 3 - expired and cleaned reports reject unchanged-current-photo duplicates without a new deadline';
-- Restore ONLY the rolled-back fixture so the independent pinning tests below remain live.
reset role;
update public.reports set photo_path='b7350001-3333-4333-8333-333333333333/11111111-1111-4111-8111-111111111111.jpg',
 photo_expires_at=clock_timestamp()+interval '1 hour'
 where target_kind='profile_photo' and target_id='b7350001-3333-4333-8333-333333333333';
set local role service_role;

do $$ begin
 if not pg_temp.photo_denied('b7350001-3333-4333-8333-333333333333',1)
 or not pg_temp.photo_denied('b7350003-3333-4333-8333-333333333333',1)
 or not pg_temp.photo_denied('b7350002-3333-4333-8333-333333333333',0)
 then raise exception 'Unauthorized or stale report accepted'; end if;
end $$;
select 'ok 4 - self, stranger and stale revisions rejected uniformly';
reset role;
insert into public.blocks(blocker_id,blocked_id) values
 ('b7350001-3333-4333-8333-333333333333','b7350002-3333-4333-8333-333333333333');
set local role service_role;
do $$ begin
 if not pg_temp.photo_denied('b7350002-3333-4333-8333-333333333333',1) then raise exception 'Reverse block bypass'; end if;
end $$;
reset role;
delete from public.blocks where blocker_id='b7350001-3333-4333-8333-333333333333';
insert into public.blocks(blocker_id,blocked_id) values
 ('b7350002-3333-4333-8333-333333333333','b7350001-3333-4333-8333-333333333333');
set local role service_role;
do $$ begin
 if not pg_temp.photo_denied('b7350002-3333-4333-8333-333333333333',1) then raise exception 'Forward block bypass'; end if;
end $$;
reset role;
delete from public.blocks where blocker_id='b7350002-3333-4333-8333-333333333333';
delete from public.friendships where requester_id='b7350001-3333-4333-8333-333333333333';
set local role service_role;
do $$ begin
 if not pg_temp.photo_denied('b7350002-3333-4333-8333-333333333333',1) then raise exception 'Unfriended access'; end if;
end $$;
select 'ok 5 - both block directions and revoked relationship deny new reports, including duplicates';
do $$ declare changed jsonb; begin
 changed:=public.avatar_change('b7350001-3333-4333-8333-333333333333',1,
 'b7350001-3333-4333-8333-333333333333/22222222-2222-4222-8222-222222222222.jpg');
 if changed->>'previousPath' is not null then raise exception 'Replacement deletes evidence'; end if;
 if exists(select 1 from public.avatar_orphans() path where path like '%111111111111.jpg') then raise exception 'Sweep deletes evidence'; end if;
 begin
  perform public.avatar_moderation_remove((select id from public.reports where target_kind='profile_photo' and target_id='b7350001-3333-4333-8333-333333333333'));
  raise exception 'Old report removed newer photo';
 exception when sqlstate 'PT409' then null; end;
end $$;
select 'ok 6 - replacement retains reported object and moderation cannot remove a newer revision';
reset role;
do $$ begin
 if has_function_privilege('authenticated','public.avatar_moderation_evidence(uuid)','execute')
 or has_function_privilege('anon','public.avatar_moderation_remove(uuid)','execute')
 or has_function_privilege('authenticated','public.avatar_report_create(uuid,uuid,bigint,text)','execute')
 then raise exception 'Moderator/report RPC exposed'; end if;
end $$;
set local role authenticated;
do $$ begin
 begin perform * from public.reports; raise exception 'Reports client readable'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'ok 7 - ordinary users cannot read evidence or call operator/report RPCs directly';
insert into public.friendships(requester_id,addressee_id,status,accepted_at) values
 ('b7350001-3333-4333-8333-333333333333','b7350002-3333-4333-8333-333333333333','accepted',now());
set local role service_role;
do $$ declare report_id uuid; begin
 if not pg_temp.photo_denied('b7350002-3333-4333-8333-333333333333',1) then raise exception 'Replaced revision report accepted'; end if;
 report_id:=public.avatar_report_create('b7350002-3333-4333-8333-333333333333','b7350001-3333-4333-8333-333333333333',2,'Abuse');
 if public.avatar_moderation_evidence(report_id) not like '%222222222222.jpg' then raise exception 'Wrong evidence'; end if;
 perform public.avatar_moderation_remove(report_id);
 if not exists(select 1 from public.profiles where id='b7350001-3333-4333-8333-333333333333' and avatar_revision=3 and avatar_path is null)
 then raise exception 'Removal not revisioned'; end if;
 begin
  perform public.avatar_change('b7350001-3333-4333-8333-333333333333',2,'b7350001-3333-4333-8333-333333333333/22222222-2222-4222-8222-222222222222.jpg');
  raise exception 'Stale owner restored revision';
 exception when sqlstate 'PT409' then null; end;
end $$;
select 'ok 8 - moderator reviews exact file, removes current revision and invalidates stale writes';
reset role;
update public.reports set photo_expires_at=now()-interval '1 second' where target_kind='profile_photo';
set local role service_role;
do $$ begin
 begin
  perform public.avatar_moderation_evidence((select id from public.reports where target_kind='profile_photo' and photo_revision=1));
  raise exception 'Expired evidence readable';
 exception when sqlstate 'PT404' then null; end;
 perform public.avatar_expire_evidence();
 if exists(select 1 from public.reports where target_kind='profile_photo' and photo_path is not null)
 then raise exception 'Expired paths retained'; end if;
 if not exists(select 1 from public.avatar_orphans() path where path like '%111111111111.jpg') then raise exception 'Expired orphan not eligible'; end if;
end $$;
select 'ok 9 - expiry denies operator retrieval and releases retired evidence to Storage API sweep';
reset role;
-- A fresh report, then account-deletion intent freezes even moderator reads.
update public.profiles set avatar_path='b7350001-3333-4333-8333-333333333333/22222222-2222-4222-8222-222222222222.jpg' where id='b7350001-3333-4333-8333-333333333333';
insert into public.friendships(requester_id,addressee_id,status,accepted_at) values
 ('b7350001-3333-4333-8333-333333333333','b7350004-3333-4333-8333-333333333333','accepted',now());
insert into public.rate_limit_events(user_id,action)
 select 'b7350004-3333-4333-8333-333333333333','report' from generate_series(1,10);
set local role service_role;
do $$ begin
 begin
  perform public.avatar_report_create('b7350004-3333-4333-8333-333333333333','b7350001-3333-4333-8333-333333333333',3,'Abuse');
  raise exception 'Photo report bypassed shared daily quota';
 exception when sqlstate 'PT429' then null; end;
end $$;
reset role;
delete from public.rate_limit_events where user_id='b7350004-3333-4333-8333-333333333333';
set local role service_role;
do $$ begin
 perform public.avatar_report_create('b7350004-3333-4333-8333-333333333333','b7350001-3333-4333-8333-333333333333',3,'Abuse');
end $$;
reset role;
delete from auth.users where id='b7350004-3333-4333-8333-333333333333';
do $$ begin
 if exists(select 1 from public.reports where reporter_id='b7350004-3333-4333-8333-333333333333') then raise exception 'Reporter evidence survived cascade'; end if;
end $$;
select 'ok 10 - photo reports share daily quota and reporter deletion cascades evidence references';
set local role service_role;
do $$ declare rid uuid; begin
 rid:=public.avatar_report_create('b7350002-3333-4333-8333-333333333333','b7350001-3333-4333-8333-333333333333',3,'Abuse');
 perform public.avatar_begin_account_delete('b7350001-3333-4333-8333-333333333333');
 begin perform public.avatar_moderation_evidence(rid); raise exception 'Deletion evidence readable';
 exception when sqlstate 'PT404' then null; end;
end $$;
select 'ok 11 - account-deletion intent revokes evidence lookup';
reset role;
delete from auth.users where id='b7350001-3333-4333-8333-333333333333';
do $$ begin
 if exists(select 1 from public.reports where reported_user_id='b7350001-3333-4333-8333-333333333333') then raise exception 'Owner reports survived deletion'; end if;
end $$;
select 'ok 12 - account deletion cascades photo report metadata; physical deletion is tested separately';
rollback;
