-- Structural performance regression: count actual RLS policy evaluations rather
-- than relying on machine-dependent wall-clock thresholds. All instrumentation
-- and fixtures roll back; the membership predicate itself is unchanged.
begin;
select '1..6';
insert into auth.users(id,raw_user_meta_data) values
 ('a9000001-2222-4222-8222-222222222222','{}'),
 ('a9000002-2222-4222-8222-222222222222','{}');
insert into public.picks(id,host_id,state,category,center_lat,center_lng,radius_m,created_at)
select ('a'||lpad(n::text,7,'0')||'-3333-4333-8333-333333333333')::uuid,
 'a9000001-2222-4222-8222-222222222222','canceled','food',40,-73,1000,
 '2020-01-01'::timestamptz + n * interval '1 second' from generate_series(1,1006)n;
insert into public.pick_participants(pick_id,user_id)
select id,'a9000001-2222-4222-8222-222222222222' from public.picks
where host_id='a9000001-2222-4222-8222-222222222222';

create sequence private.summary_policy_calls;
create or replace function private.is_pick_participant(p_pick_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 perform nextval('private.summary_policy_calls'::regclass);
 return exists(select 1 from public.pick_participants
   where pick_id=p_pick_id and user_id=(select auth.uid()));
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','a9000001-2222-4222-8222-222222222222',true);
do $$ declare ids uuid[]; begin
 select array_agg(id) into ids from public.my_pick_summaries(true,null,null,5);
 if cardinality(ids)<>5 or ids[1]<>'a0001006-3333-4333-8333-333333333333' then
  raise exception 'Wrong latest page'; end if;
end $$;
reset role;
do $$ declare calls bigint; begin
 select last_value into calls from private.summary_policy_calls;
 if calls<5 or calls>10 then raise exception 'RLS must check returned Picks, not all history: % calls',calls; end if;
end $$;
select '# five-row page RLS calls: '||last_value from private.summary_policy_calls;
select 'ok 1 - over 1000 records, but five-row page performs bounded real RLS checks';

alter sequence private.summary_policy_calls restart with 1;
set local role authenticated;
do $$ begin
 if (select count(*) from public.my_pick_summaries(true,null,null,100))<>100 then raise exception 'Page cap changed'; end if;
end $$;
reset role;
do $$ declare calls bigint; begin
 select last_value into calls from private.summary_policy_calls;
 if calls<100 or calls>110 then raise exception 'RLS work must scale with page size: % calls',calls; end if;
end $$;
select '# 100-row page RLS calls: '||last_value from private.summary_policy_calls;
select 'ok 2 - 100-row pages retain RLS with work proportional to page size';

do $$ begin
 if (select prosecdef from pg_proc where oid='public.my_pick_summaries(boolean,timestamptz,uuid,integer)'::regprocedure) then
  raise exception 'Public summary RPC must remain security invoker'; end if;
 if not (select prosecdef from pg_proc where oid='private.my_pick_summary_ids(boolean,timestamptz,uuid,integer)'::regprocedure)
  or (select proowner::regrole::text from pg_proc where oid='private.my_pick_summary_ids(boolean,timestamptz,uuid,integer)'::regprocedure)<>'postgres' then
  raise exception 'Private helper boundary changed'; end if;
 if exists(select 1 from pg_class where oid in ('public.picks'::regclass,'public.pick_participants'::regclass,'public.pick_candidates'::regclass) and not relrowsecurity) then
  raise exception 'RLS disabled'; end if;
 if has_function_privilege('anon','public.my_pick_summaries(boolean,timestamptz,uuid,integer)','execute')
  or has_function_privilege('anon','private.my_pick_summary_ids(boolean,timestamptz,uuid,integer)','execute') then
  raise exception 'Anonymous execution allowed'; end if;
end $$;
select 'ok 3 - public RPC stays invoker, private helper unexposed, table RLS and grants preserved';

create policy summary_restrictive_test on public.picks as restrictive for select to authenticated
 using(id<>'a0001006-3333-4333-8333-333333333333'::uuid);
set local role authenticated;
do $$ begin
 if (select count(*) from public.my_pick_summaries(true,null,null,5))<>4
   or exists(select from public.my_pick_summaries(true,null,null,5) where id='a0001006-3333-4333-8333-333333333333') then
  raise exception 'Private ID selection bypassed returned-row RLS'; end if;
end $$;
select 'ok 4 - additional restrictive RLS still filters an authorized selected Pick';

select set_config('request.jwt.claim.sub','a9000002-2222-4222-8222-222222222222',true);
do $$ begin
 if exists(select from public.my_pick_summaries(true)) then raise exception 'Outsider exposure'; end if;
end $$;
select 'ok 5 - outsider cannot read selected IDs or rows through the public RPC';

select set_config('request.jwt.claim.sub','',true);
do $$ begin
 if exists(select from public.my_pick_summaries(true)) then raise exception 'Missing identity exposure'; end if;
end $$;
select 'ok 6 - missing identity cannot select a page';
rollback;
