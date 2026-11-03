-- Standalone TAP; real RLS/RPCs, no pgTAP dependency. All fixtures roll back.
begin;
select '1..9';
insert into auth.users(id,raw_user_meta_data) select
 ('a'||repeat(i::text,7)||'-1111-4111-8111-111111111111')::uuid,'{}'::jsonb from generate_series(1,4) i;
insert into public.groups(id,name,owner_id) values
 ('a0000000-1111-4111-8111-111111111111','Idea crew','a1111111-1111-4111-8111-111111111111'),
 ('b0000000-1111-4111-8111-111111111111','Other crew','a1111111-1111-4111-8111-111111111111');
insert into public.group_members(group_id,user_id,role) select
 'a0000000-1111-4111-8111-111111111111',('a'||repeat(i::text,7)||'-1111-4111-8111-111111111111')::uuid,
 case when i=1 then 'owner' else 'member' end from generate_series(1,3) i;
insert into public.group_members(group_id,user_id,role) values
 ('b0000000-1111-4111-8111-111111111111','a1111111-1111-4111-8111-111111111111','owner');
create temporary table idea_test(id uuid) on commit drop;
grant all on idea_test to service_role;
-- Other suite files or seed data may already have Picks; creation must add none.
create temporary table idea_pick_baseline on commit drop as select count(*) as pick_count from public.picks;
grant select on idea_pick_baseline to service_role;
set local role service_role;
insert into idea_test select (public.group_ideas('create','a2222222-1111-4111-8111-111111111111','a0000000-1111-4111-8111-111111111111',null,
 '{"name":"Catan","category":"activity","description":"Bring snacks","locationText":"John’s house","createdBy":"a1111111-1111-4111-8111-111111111111"}')->>'id')::uuid;
do $$ declare r jsonb; begin
 r:=public.group_ideas('list','a3333333-1111-4111-8111-111111111111','a0000000-1111-4111-8111-111111111111');
 if jsonb_array_length(r)<>1 or r->0->>'created_by'<>'a2222222-1111-4111-8111-111111111111' then raise exception 'Wrong creator/list'; end if;
 if (select count(*) from public.picks)<>(select pick_count from idea_pick_baseline) then raise exception 'Idea created Pick'; end if;
end $$;
select 'ok 1 - current members create/read, caller is creator, no Pick created';
do $$ declare r jsonb; old_time timestamptz; begin
 select updated_at into old_time from public.group_ideas where id=(select id from idea_test);
 r:=public.group_ideas('update','a2222222-1111-4111-8111-111111111111','a0000000-1111-4111-8111-111111111111',(select id from idea_test),'{"name":"Dinner","category":"food"}');
 if r->>'name'<>'Dinner' or r->>'description' is not null or (r->>'updated_at')::timestamptz<=old_time then raise exception 'Update failed'; end if;
 if r->>'created_by'<>'a2222222-1111-4111-8111-111111111111' or r->>'group_id'<>'a0000000-1111-4111-8111-111111111111' then raise exception 'Identity changed'; end if;
end $$;
select 'ok 2 - creator updates fields/timestamp, preserves group/creator';
do $$ begin
 begin perform public.group_ideas('update','a3333333-1111-4111-8111-111111111111','a0000000-1111-4111-8111-111111111111',(select id from idea_test),'{"name":"No","category":"food"}'); raise exception 'Other member edited'; exception when sqlstate 'PT403' then null; end;
 begin perform public.group_ideas('delete','a3333333-1111-4111-8111-111111111111','a0000000-1111-4111-8111-111111111111',(select id from idea_test)); raise exception 'Other member deleted'; exception when sqlstate 'PT403' then null; end;
 begin perform public.group_ideas('update','a1111111-1111-4111-8111-111111111111','a0000000-1111-4111-8111-111111111111',(select id from idea_test),'{"name":"No","category":"food"}'); raise exception 'Owner edited another creator'; exception when sqlstate 'PT403' then null; end;
end $$;
select 'ok 3 - only creator edits; ordinary members cannot delete others ideas';
do $$ declare a text; begin
 foreach a in array array['list','get','create','update','delete'] loop
 begin perform public.group_ideas(a,'a4444444-1111-4111-8111-111111111111','a0000000-1111-4111-8111-111111111111',(select id from idea_test),'{"name":"No","category":"food"}'); raise exception 'Outsider accessed %',a; exception when sqlstate 'PT404' then null; end;
 end loop;
 begin perform public.group_ideas('get','a1111111-1111-4111-8111-111111111111','b0000000-1111-4111-8111-111111111111',(select id from idea_test)); raise exception 'Cross-group access'; exception when sqlstate 'PT404' then null; end;
end $$;
select 'ok 4 - outsiders and cross-group IDs rejected';
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','a3333333-1111-4111-8111-111111111111',true);
do $$ begin
 if (select count(*) from public.group_ideas where group_id='a0000000-1111-4111-8111-111111111111')<>1 then raise exception 'Member cannot read through RLS'; end if;
 begin insert into public.group_ideas(group_id,created_by,name,category) values('a0000000-1111-4111-8111-111111111111',auth.uid(),'No','food'); raise exception 'Direct write allowed'; exception when insufficient_privilege then null; end;
 begin perform public.group_ideas('list',auth.uid(),'a0000000-1111-4111-8111-111111111111'); raise exception 'RPC impersonation allowed'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','a4444444-1111-4111-8111-111111111111',true);
do $$ begin if exists(select 1 from public.group_ideas where group_id in ('a0000000-1111-4111-8111-111111111111','b0000000-1111-4111-8111-111111111111')) then raise exception 'RLS leaked'; end if; end $$;
select 'ok 5 - real RLS members-only; clients cannot write or invoke service RPC';
reset role;
delete from public.group_members where group_id='a0000000-1111-4111-8111-111111111111' and user_id='a2222222-1111-4111-8111-111111111111';
set local role service_role;
do $$ declare a text; begin
 foreach a in array array['list','get','create','update','delete'] loop
 begin perform public.group_ideas(a,'a2222222-1111-4111-8111-111111111111','a0000000-1111-4111-8111-111111111111',(select id from idea_test),'{"name":"No","category":"food"}'); raise exception 'Former member accessed'; exception when sqlstate 'PT404' then null; end;
 end loop;
 perform public.group_ideas('delete','a1111111-1111-4111-8111-111111111111','a0000000-1111-4111-8111-111111111111',(select id from idea_test));
 if exists(select 1 from public.group_ideas where id=(select id from idea_test)) then raise exception 'Owner moderation failed'; end if;
end $$;
select 'ok 6 - removed creator loses access; owner can moderate orphaned ideas';
do $$ begin
 begin perform public.group_ideas('create','a1111111-1111-4111-8111-111111111111','a0000000-1111-4111-8111-111111111111',null,'{"name":"No","category":"custom"}'); raise exception 'Bad category stored'; exception when check_violation then null; end;
 begin perform public.group_ideas('create','a1111111-1111-4111-8111-111111111111','a0000000-1111-4111-8111-111111111111',null,'{"name":"No","category":"food","description":42}'); raise exception 'Bad description stored'; exception when sqlstate 'PT400' then null; end;
end $$;
select 'ok 7 - database validation rejects invalid category and field shapes';
select public.group_ideas('create','a1111111-1111-4111-8111-111111111111','a0000000-1111-4111-8111-111111111111',null,'{"name":"Beach","category":"activity"}');
reset role;
delete from public.groups where id='a0000000-1111-4111-8111-111111111111';
do $$ begin if exists(select 1 from public.group_ideas where group_id='a0000000-1111-4111-8111-111111111111') then raise exception 'Group cascade failed'; end if; end $$;
select 'ok 8 - group deletion cascades its ideas';
insert into public.group_members(group_id,user_id,role) values
 ('b0000000-1111-4111-8111-111111111111','a2222222-1111-4111-8111-111111111111','member');
set local role service_role;
select public.group_ideas('create','a2222222-1111-4111-8111-111111111111','b0000000-1111-4111-8111-111111111111',null,'{"name":"Dinner","category":"food"}');
reset role;
delete from auth.users where id='a2222222-1111-4111-8111-111111111111';
do $$ begin
 if exists(select 1 from public.group_ideas where group_id='b0000000-1111-4111-8111-111111111111') or not exists(select 1 from public.groups where id='b0000000-1111-4111-8111-111111111111') then raise exception 'Creator deletion cascade failed'; end if;
end $$;
select 'ok 9 - creator account deletion removes ideas without deleting another owners group';
rollback;
