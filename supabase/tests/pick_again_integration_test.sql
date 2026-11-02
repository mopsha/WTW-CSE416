-- Standalone TAP, matching custom_plans_hang_test.sql; all fixtures roll back.
begin;
select '1..4';
insert into auth.users(id, raw_user_meta_data) values
 ('c1111111-1111-4111-8111-111111111111','{}'),
 ('c2222222-2222-4222-8222-222222222222','{}'),
 ('c3333333-3333-4333-8333-333333333333','{}');
do $$
declare
 host uuid := 'c1111111-1111-4111-8111-111111111111';
 former uuid := 'c2222222-2222-4222-8222-222222222222';
 current_member uuid := 'c3333333-3333-4333-8333-333333333333';
 g uuid; old_id uuid; new_id uuid; options jsonb; result jsonb;
begin
 insert into public.friendships(requester_id, addressee_id, status, accepted_at)
 values(host, former, 'accepted', now()), (host, current_member, 'accepted', now());
 g := (public.group_create(host, 'Integration') ->> 'id')::uuid;
 perform public.group_add_members(host, g, array[former]);
 old_id := (public.pick_create_options(host,
  '{"category":"custom","center":{"lat":40,"lng":-73},"radiusM":5000,"poolSize":4,"deadlineAt":null,"closeThreshold":100,"priceMax":2,"openNow":true,"includeSaved":true,"mixCategory":"activities","customOptions":[{"name":"Cards"},{"name":"Movie"},{"name":"Cookout"},{"name":"Study"}]}') ->> 'id')::uuid;
 perform public.pick_add_group(old_id, host, g);
 update public.picks set state='canceled' where id=old_id;
 perform public.group_remove_member(host, g, former);
 perform public.group_add_members(host, g, array[current_member]);
 result := public.pick_again(old_id::text, host);
 new_id := (result ->> 'id')::uuid;
 if not exists(select 1 from public.pick_participants where pick_id=old_id and user_id=former)
 or exists(select 1 from public.pick_participants where pick_id=new_id and user_id=former)
 or not exists(select 1 from public.pick_participants where pick_id=new_id and user_id=current_member)
 or (select group_id from public.picks where id=new_id) is distinct from g
 or result->'addedUserIds' <> to_jsonb(array[current_member]) then
  raise exception 'Repeated Pick did not use current group membership';
 end if;
 select custom_options into options from public.picks where id=old_id;
 if not exists(select 1 from public.picks where id=new_id and price_max=2 and open_now
   and include_saved and mix_category='activities' and custom_options=options) then
  raise exception 'Repeated Pick lost M4 settings or option identity';
 end if;
 perform public.pick_start(new_id::text, host,
  (select jsonb_agg(jsonb_build_object('placeId',o->>'placeId','snapshot',o))
   from jsonb_array_elements(options) o));
 if (select count(*) from public.pick_candidates where pick_id=new_id) <> 4 then
  raise exception 'Repeated custom Pick did not start normally';
 end if;
end $$;
select 'ok 1 - repeat uses current group members and preserves historical membership';
select 'ok 2 - filters, saved priority, custom snapshots and mixing survive repeat';
select 'ok 3 - repeated custom Pick starts through the canonical lifecycle';
do $$
declare host uuid := 'c1111111-1111-4111-8111-111111111111';
 p uuid; u uuid; i integer;
begin
 p := (public.pick_create(host, 'food', 40, -73, 5000, 5, null, 100)->>'id')::uuid;
 for i in 1..29 loop
  u := gen_random_uuid();
  insert into auth.users(id, raw_user_meta_data) values(u, '{}');
  insert into public.pick_participants(pick_id,user_id) values(p,u);
 end loop;
 insert into public.pick_participants(pick_id,user_id) values(p,host) on conflict do nothing;
 u := gen_random_uuid();
 insert into auth.users(id, raw_user_meta_data) values(u, '{}');
 begin
  insert into public.pick_participants(pick_id,user_id) values(p,u);
  raise exception 'Thirty-first participant was allowed';
 exception when sqlstate 'PT409' then null;
 end;
end $$;
select 'ok 4 - full Picks allow existing-member retries and reject new members';
rollback;
