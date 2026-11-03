-- Standalone assertions: derived, per-user memories and conservative profile projection.
begin;
select '1..13';
insert into auth.users(id,raw_user_meta_data) select ('a'||lpad(n::text,7,'0')||'-5555-4555-8555-555555555555')::uuid,jsonb_build_object('display_name','Memory Person '||n) from generate_series(1,4)n;
insert into public.groups(id,name,owner_id) values('a0000000-5555-4555-8555-555555555555','Private memory group','a0000001-5555-4555-8555-555555555555');
insert into public.group_members(group_id,user_id,role) values
 ('a0000000-5555-4555-8555-555555555555','a0000001-5555-4555-8555-555555555555','owner'),
 ('a0000000-5555-4555-8555-555555555555','a0000002-5555-4555-8555-555555555555','member');
insert into public.friendships(requester_id,addressee_id,status,accepted_at) values
 ('a0000001-5555-4555-8555-555555555555','a0000002-5555-4555-8555-555555555555','accepted',now()),
 ('a0000001-5555-4555-8555-555555555555','a0000003-5555-4555-8555-555555555555','accepted',now());
create temporary table memory_ids(label text,id uuid) on commit drop;
grant all on memory_ids to service_role;
insert into memory_ids select 'old',(public.pick_create('a0000001-5555-4555-8555-555555555555','food',40,-73,1000,5,null,100)->>'id')::uuid;
insert into memory_ids select 'future',(public.pick_create('a0000001-5555-4555-8555-555555555555','food',40,-73,1000,5,null,100)->>'id')::uuid;
insert into public.pick_participants(pick_id,user_id) select id,'a0000002-5555-4555-8555-555555555555' from memory_ids;
insert into public.places(id,name,category,lat,lng) values('memory-place','Live edited place','food',40,-73);
insert into public.pick_candidates(pick_id,place_id,snapshot) select id,'memory-place','{"name":"Original dinner","address":"Original location","provider":"mock","retention":"persistable"}' from memory_ids;
update public.picks set state='completed',winner_place_id='memory-place',decided_at=now()-interval '2 days',decided_by='clear_winner',group_id='a0000000-5555-4555-8555-555555555555' where id in(select id from memory_ids);
update public.picks set plan_at=now()+interval '1 day' where id=(select id from memory_ids where label='future');
set local role service_role;
do $$ declare r jsonb; begin
 r:=public.profile_past_moves('a0000001-5555-4555-8555-555555555555','a0000001-5555-4555-8555-555555555555');
 if r<>'{"visible":true,"pastMoves":[]}' then raise exception 'Unconfirmed plan was marked attended'; end if;
end $$;
select 'ok 1 - completed/winner state alone never creates attendance';
select public.pick_outcome(id::text,'a0000001-5555-4555-8555-555555555555',true,null) from memory_ids;
do $$ declare r jsonb; begin
 r:=public.profile_past_moves('a0000001-5555-4555-8555-555555555555','a0000001-5555-4555-8555-555555555555');
 if jsonb_array_length(r->'pastMoves')<>1 or r->'pastMoves'->0->'winner'->>'name'<>'Original dinner' or r->'pastMoves'->0->>'attendedCount'<>'1' then raise exception 'Eligibility/snapshot wrong'; end if;
 if (select count(*) from public.pick_outcomes where user_id='a0000002-5555-4555-8555-555555555555')<>0 then raise exception 'Someone else marked attended'; end if;
end $$;
select 'ok 2 - positive personal answer creates one past memory, future plan excluded, live place ignored';
select public.pick_outcome(id::text,'a0000001-5555-4555-8555-555555555555',false,null) from memory_ids where label='old';
do $$ begin if jsonb_array_length(public.profile_past_moves('a0000001-5555-4555-8555-555555555555','a0000001-5555-4555-8555-555555555555')->'pastMoves')<>0 then raise exception 'Correction left memory'; end if; end $$;
select public.pick_outcome(id::text,'a0000001-5555-4555-8555-555555555555',true,true) from memory_ids where label='old';
do $$ begin if (select count(*) from public.pick_outcomes where user_id='a0000001-5555-4555-8555-555555555555')<>2 then raise exception 'Duplicate outcome'; end if; end $$;
select 'ok 3 - existing outcome upserts safely add/remove Past Moves without duplicate rows';
do $$ begin
 if public.profile_past_moves('a0000002-5555-4555-8555-555555555555','a0000001-5555-4555-8555-555555555555')<>'{"visible":false,"pastMoves":[]}' then raise exception 'Private metadata leaked'; end if;
end $$;
update public.profiles set share_profile_metadata=true where id='a0000001-5555-4555-8555-555555555555';
do $$ declare r jsonb; begin
 r:=public.profile_past_moves('a0000002-5555-4555-8555-555555555555','a0000001-5555-4555-8555-555555555555');
 if jsonb_array_length(r->'pastMoves')<>1 or r->'pastMoves'->0->'group'->>'name'<>'Private memory group' or r->'pastMoves'->0->>'participantCount' is not null or r::text like '%Memory Person%' then raise exception 'Projection leaked participant metadata'; end if;
 if jsonb_array_length(public.profile_past_moves('a0000003-5555-4555-8555-555555555555','a0000001-5555-4555-8555-555555555555')->'pastMoves')<>0 then raise exception 'Friend gained access to unknown plan'; end if;
end $$;
select 'ok 4 - sharing needs opt-in and original Pick access, without participant identities/counts';
select public.group_remove_member('a0000001-5555-4555-8555-555555555555','a0000000-5555-4555-8555-555555555555','a0000002-5555-4555-8555-555555555555');
do $$ declare r jsonb; begin
 r:=public.profile_past_moves('a0000002-5555-4555-8555-555555555555','a0000001-5555-4555-8555-555555555555');
 if r->'pastMoves'->0->>'group' is not null or r::text like '%Private memory group%' then raise exception 'Private group context leaked'; end if;
end $$;
select 'ok 5 - removed members retain authorized Pick history but not current private group context';
select public.block_user('a0000002-5555-4555-8555-555555555555','a0000001-5555-4555-8555-555555555555');
do $$ begin
 begin perform public.profile_past_moves('a0000002-5555-4555-8555-555555555555','a0000001-5555-4555-8555-555555555555'); raise exception 'Blocked access'; exception when sqlstate 'PT404' then null; end;
 begin perform public.profile_past_moves('a0000004-5555-4555-8555-555555555555','a0000001-5555-4555-8555-555555555555'); raise exception 'Stranger access'; exception when sqlstate 'PT404' then null; end;
end $$;
select 'ok 6 - blocked/nonfriends denied regardless of profile setting';
reset role;
-- A custom/group-idea snapshot has the same winner projection and no live library dependency.
insert into public.group_ideas(id,group_id,created_by,name,category) values('a9999999-5555-4555-8555-555555555555','a0000000-5555-4555-8555-555555555555','a0000001-5555-4555-8555-555555555555','Edited current idea','activity');
update public.pick_candidates set snapshot='{"name":"Catan at John’s","address":"Original home","origin":"group_idea","groupIdeaId":"a9999999-5555-4555-8555-555555555555"}' where pick_id=(select id from memory_ids where label='old');
delete from public.group_ideas where id='a9999999-5555-4555-8555-555555555555';
set local role service_role;
do $$ declare r jsonb; begin
 r:=public.profile_past_moves('a0000001-5555-4555-8555-555555555555','a0000001-5555-4555-8555-555555555555');
 if r->'pastMoves'->0->'winner'->>'name'<>'Catan at John’s' or r->'pastMoves'->0->'winner'->>'locationText'<>'Original home' or r->'pastMoves'->0->'winner'->>'origin'<>'group_idea' then raise exception 'Frozen idea projection lost'; end if;
end $$;
select 'ok 7 - Group Idea memories use frozen content after library deletion';
reset role;
update public.pick_candidates set snapshot='{"name":"Restricted Google name","provider":"google","address":"Restricted address"}' where pick_id=(select id from memory_ids where label='old');
set local role service_role;
do $$ declare r jsonb; begin
 r:=public.profile_past_moves('a0000001-5555-4555-8555-555555555555','a0000001-5555-4555-8555-555555555555');
 if r->'pastMoves'->0->'winner'->>'name' is not null or r->'pastMoves'->0->'winner'->>'locationText' is not null then raise exception 'Google display retained'; end if;
end $$;
select 'ok 8 - legacy/request-only Google content is not displayed or hydrated';
select public.pick_outcome(id::text,'a0000002-5555-4555-8555-555555555555',true,null) from memory_ids where label='old';
reset role;
delete from public.groups where id='a0000000-5555-4555-8555-555555555555';
set local role service_role;
do $$ declare r jsonb; begin
 r:=public.profile_past_moves('a0000002-5555-4555-8555-555555555555','a0000002-5555-4555-8555-555555555555');
 if jsonb_array_length(r->'pastMoves')<>1 or r->'pastMoves'->0->>'group' is not null then raise exception 'Group deletion damaged historical Pick'; end if;
end $$;
select 'ok 9 - group deletion preserves attended Pick with no orphan group label';
reset role;
delete from auth.users where id='a0000001-5555-4555-8555-555555555555';
set local role service_role;
do $$ begin
 if exists(select 1 from public.pick_outcomes where user_id='a0000001-5555-4555-8555-555555555555') then raise exception 'Deleted attendance retained'; end if;
 if jsonb_array_length(public.profile_past_moves('a0000002-5555-4555-8555-555555555555','a0000002-5555-4555-8555-555555555555')->'pastMoves')<>1 then raise exception 'Remaining participant lost memory'; end if;
 begin perform public.profile_past_moves('a0000002-5555-4555-8555-555555555555','a0000001-5555-4555-8555-555555555555'); raise exception 'Deleted profile visible'; exception when sqlstate 'PT404' then null; end;
end $$;
select 'ok 10 - account deletion erases personal attendance/visibility and preserves remaining history';
reset role;
set local role authenticated;
do $$ begin
 begin perform public.profile_past_moves('a0000002-5555-4555-8555-555555555555','a0000002-5555-4555-8555-555555555555'); raise exception 'Client impersonated viewer'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'ok 11 - client cannot invoke the service projection with a forged viewer';
set local role service_role;
do $$ begin
 begin perform public.profile_past_moves('a0000002-5555-4555-8555-555555555555','a0000002-5555-4555-8555-555555555555','a0000000-5555-4555-8555-555555555555'); raise exception 'Deleted group accessible'; exception when sqlstate 'PT404' then null; end;
end $$;
reset role;
select 'ok 12 - group-filtered reads retain current membership authorization';
set local role service_role;
do $$ declare i integer; v_pick_id uuid; r jsonb; begin
 for i in 1..55 loop
  insert into public.picks(host_id,category,center_lat,center_lng,radius_m) values('a0000002-5555-4555-8555-555555555555','food',40,-73,1000) returning picks.id into v_pick_id;
  insert into public.pick_participants(pick_id,user_id) values(v_pick_id,'a0000002-5555-4555-8555-555555555555');
  insert into public.pick_candidates(pick_id,place_id,snapshot) values(v_pick_id,'memory-place',jsonb_build_object('name','Fixture '||i,'provider','mock'));
  update public.picks set state='completed',winner_place_id='memory-place',decided_by='clear_winner',decided_at=now()-interval '4 hours'-i*interval '1 minute' where picks.id=v_pick_id;
  perform public.pick_outcome(v_pick_id::text,'a0000002-5555-4555-8555-555555555555',true,null);
 end loop;
 r:=public.profile_past_moves('a0000002-5555-4555-8555-555555555555','a0000002-5555-4555-8555-555555555555');
 if jsonb_array_length(r->'pastMoves')<>50 or r->'pastMoves'->0->'winner'->>'name'<>'Fixture 1' or r->'pastMoves'->49->'winner'->>'name'<>'Fixture 50' then raise exception 'Unbounded or unordered Past Moves'; end if;
end $$;
reset role;
select 'ok 13 - recent Past Moves are bounded to 50 in deterministic occurrence order';
rollback;
