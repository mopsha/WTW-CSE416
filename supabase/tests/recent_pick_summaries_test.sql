begin;
select '1..8';
insert into auth.users(id,raw_user_meta_data) values
 ('c0000001-2222-4222-8222-222222222222','{}'),
 ('c0000002-2222-4222-8222-222222222222','{}');
insert into public.picks(id,host_id,state,category,center_lat,center_lng,radius_m,created_at)
select ('d'||lpad(n::text,7,'0')||'-2222-4222-8222-222222222222')::uuid,
 'c0000001-2222-4222-8222-222222222222','canceled','food',40,-73,1000,
 '2020-01-01'::timestamptz from generate_series(1,1001)n;
insert into public.picks(id,host_id,state,category,center_lat,center_lng,radius_m,created_at)
values
 ('e0000001-2222-4222-8222-222222222222','c0000001-2222-4222-8222-222222222222','canceled','food',40,-73,1000,'2026-01-02'),
 ('e0000002-2222-4222-8222-222222222222','c0000001-2222-4222-8222-222222222222','canceled','food',40,-73,1000,'2026-01-02'),
 ('e0000003-2222-4222-8222-222222222222','c0000001-2222-4222-8222-222222222222','draft','food',40,-73,1000,'2026-01-03');
insert into public.pick_participants(pick_id,user_id)
select id,'c0000001-2222-4222-8222-222222222222' from public.picks
where host_id='c0000001-2222-4222-8222-222222222222';
set local role authenticated;
select set_config('request.jwt.claim.sub','c0000001-2222-4222-8222-222222222222',true);
do $$ declare ids uuid[]; begin
 select array_agg(id) into ids from public.my_pick_summaries(true,null,null,5);
 if cardinality(ids)<>5 or ids[1]<>'e0000001-2222-4222-8222-222222222222' or ids[2]<>'e0000002-2222-4222-8222-222222222222' then raise exception 'Latest terminal rows lost at API cap'; end if;
end $$;
select 'ok 1 - server sorts before bounding beyond 1000 rows with deterministic ties';
do $$ begin
 if (select id from public.my_pick_summaries(true,'2026-01-02','e0000001-2222-4222-8222-222222222222',1)) <> 'e0000002-2222-4222-8222-222222222222' then raise exception 'Tie cursor skipped row'; end if;
end $$;
select 'ok 2 - keyset page boundary keeps equal timestamps';
do $$ begin
 if (select count(*) from public.my_pick_summaries(false))<>1 then raise exception 'Active/history separation failed'; end if;
 if (select count(*) from public.my_pick_summaries(true))<>100 then raise exception 'Page cap failed'; end if;
end $$;
select 'ok 3 - active rows separate and terminal payload bounded';
do $$ begin
 if exists(select from public.my_pick_summaries(true,'1900-01-01','e0000001-2222-4222-8222-222222222222',5)) then raise exception 'Empty page not empty'; end if;
end $$;
select 'ok 4 - exhausted cursor returns empty page';
do $$ begin
 begin perform public.my_pick_summaries(true,null,null,101); raise exception 'Invalid limit accepted'; exception when invalid_parameter_value then null; end;
 begin perform public.my_pick_summaries(true,now(),null,5); raise exception 'Half cursor accepted'; exception when invalid_parameter_value then null; end;
end $$;
select 'ok 5 - invalid pages rejected';
select set_config('request.jwt.claim.sub','c0000002-2222-4222-8222-222222222222',true);
do $$ begin
 if exists(select from public.my_pick_summaries(true)) or exists(select from public.my_pick_summaries(false)) then raise exception 'Outsider exposure'; end if;
end $$;
select 'ok 6 - outsiders cannot read another user summaries';
reset role;
delete from public.pick_participants where pick_id='e0000001-2222-4222-8222-222222222222';
set local role authenticated;
select set_config('request.jwt.claim.sub','c0000001-2222-4222-8222-222222222222',true);
do $$ begin
 if exists(select from public.my_pick_summaries(true) where id='e0000001-2222-4222-8222-222222222222') then raise exception 'Revoked row exposed'; end if;
end $$;
select 'ok 7 - participation removal rechecked on next request';
do $$ begin
 if has_function_privilege('anon','public.my_pick_summaries(boolean,timestamp with time zone,uuid,integer)','execute') then raise exception 'Anonymous grant'; end if;
end $$;
select 'ok 8 - anonymous execution revoked';
rollback;
