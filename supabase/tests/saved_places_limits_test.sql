-- TAP without extension dependencies. Run with supabase test db or psql -v ON_ERROR_STOP=1.
begin;
select '1..9';
insert into auth.users(id, raw_user_meta_data) values
 ('a1111111-1111-4111-8111-111111111111', '{}'),
 ('a2222222-2222-4222-8222-222222222222', '{}');
create temporary table phase1_pick as select (public.pick_create_filtered(
 'a1111111-1111-4111-8111-111111111111', 'activities', 40.9126, -73.1234,
 5000, 20, null, 100, 2::smallint, true)->>'id')::uuid as id;
grant select on phase1_pick to service_role, authenticated;
set local role service_role;
do $$ declare v_pick jsonb; begin
 v_pick := public.pick_load_filtered((select id::text from phase1_pick), 'a1111111-1111-4111-8111-111111111111');
 if (v_pick->>'priceMax')::int <> 2 or not (v_pick->>'openNow')::boolean then raise exception 'Filters did not round trip'; end if;
end $$;
select 'ok 1 - filters round trip through canonical lifecycle wrappers';
insert into public.saved_places(user_id, place_id) values
 ('a1111111-1111-4111-8111-111111111111', 'google-id-only'),
 ('a2222222-2222-4222-8222-222222222222', 'other-place');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1111111-1111-4111-8111-111111111111', true);
do $$ begin
 if (select count(*) from public.saved_places) <> 1 then raise exception 'Saved RLS leaked'; end if;
 if (select place_id from public.saved_places) <> 'google-id-only' then raise exception 'Wrong saved owner'; end if;
end $$;
select 'ok 2 - authenticated reads only own saves';
do $$ begin
 begin insert into public.saved_places(user_id, place_id) values ('a1111111-1111-4111-8111-111111111111', 'denied'); raise exception 'Client write allowed'; exception when insufficient_privilege then null; end;
 begin perform * from public.provider_usage; raise exception 'Usage exposed'; exception when insufficient_privilege then null; end;
 begin perform * from public.rate_limit_counters; raise exception 'Limits exposed'; exception when insufficient_privilege then null; end;
 begin perform public.consume_provider_call(999); raise exception 'Counter RPC exposed'; exception when insufficient_privilege then null; end;
 begin perform discover_preferences from public.profiles; raise exception 'Profile preferences exposed'; exception when insufficient_privilege then null; end;
end $$;
select 'ok 3 - client writes, counters, RPCs and private profile fields denied';
reset role;
set local role anon;
do $$ begin
 begin perform * from public.saved_places; raise exception 'Anonymous saves exposed'; exception when insufficient_privilege then null; end;
end $$;
select 'ok 4 - anonymous saves denied';
reset role;
-- Isolate the test from today's production counters; rollback restores them.
delete from public.provider_usage;
set local role service_role;
do $$ begin
 if public.consume_provider_call(0) then raise exception 'Zero cap allowed'; end if;
 if not public.consume_provider_call(2) or not public.consume_provider_call(2) or public.consume_provider_call(2) then raise exception 'Provider cap boundary wrong'; end if;
 if (select calls from public.provider_usage) <> 2 then raise exception 'Provider overshot cap'; end if;
end $$;
select 'ok 5 - provider cap is inclusive and denied attempts do not increment';
do $$ declare i integer; begin
 for i in 1..20 loop
  if not public.consume_user_limit('create', 'a1111111-1111-4111-8111-111111111111') then raise exception 'Create denied early'; end if;
 end loop;
 if public.consume_user_limit('create', 'a1111111-1111-4111-8111-111111111111') then raise exception '21st create allowed'; end if;
 if not public.consume_user_limit('create', 'a2222222-2222-4222-8222-222222222222') then raise exception 'User counters not isolated'; end if;
end $$;
select 'ok 6 - create is 20 per UTC day per user';
do $$ declare i integer; v_id text := (select id::text from phase1_pick); v_scope text; begin
 foreach v_scope in array array['start', 'refresh'] loop
  for i in 1..5 loop
   if not public.consume_user_limit(v_scope, 'a1111111-1111-4111-8111-111111111111', v_id) then raise exception 'Pool request denied early'; end if;
  end loop;
  if public.consume_user_limit(v_scope, 'a1111111-1111-4111-8111-111111111111', v_id) then raise exception 'Sixth pool request allowed'; end if;
 end loop;
 begin perform public.consume_user_limit('refresh', 'a2222222-2222-4222-8222-222222222222', v_id); raise exception 'Nonhost used quota'; exception when sqlstate 'PT403' then null; end;
end $$;
select 'ok 7 - start and refresh capped at five attempts each per Pick, host only';
delete from public.saved_places where user_id = 'a1111111-1111-4111-8111-111111111111' and place_id = 'google-id-only';
do $$ begin
 if exists (select 1 from public.saved_places where user_id = 'a1111111-1111-4111-8111-111111111111') then raise exception 'Delete failed'; end if;
 if not exists (select 1 from public.saved_places where user_id = 'a2222222-2222-4222-8222-222222222222') then raise exception 'Delete crossed owners'; end if;
end $$;
select 'ok 8 - service deletes one owner without affecting another';
reset role;
delete from public.provider_usage;
insert into public.provider_usage(provider, day, calls) values ('google', (now() at time zone 'UTC')::date - 1, 100);
insert into public.rate_limit_counters(scope, subject, bucket, calls) values
 ('create', 'a2222222-2222-4222-8222-222222222222', ((now() at time zone 'UTC')::date - 1)::text, 20);
set local role service_role;
do $$ begin
 if not public.consume_provider_call(1) then raise exception 'Yesterday provider count affected today'; end if;
 if not public.consume_user_limit('create', 'a2222222-2222-4222-8222-222222222222') then raise exception 'Yesterday user count affected today'; end if;
end $$;
select 'ok 9 - prior UTC day counters do not consume today quota';
rollback;
