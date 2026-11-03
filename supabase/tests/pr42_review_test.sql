-- PR #42 regressions. Standalone TAP; every fixture rolls back.
begin;
select '1..8';
insert into auth.users(id,raw_user_meta_data) select
 ('a420000'||n||'-4242-4242-8242-424242424242')::uuid,'{}'::jsonb from generate_series(1,3)n;
insert into public.groups(id,name,owner_id) values('a4200000-4242-4242-8242-424242424242','Review','a4200001-4242-4242-8242-424242424242');
insert into public.group_members(group_id,user_id,role) values('a4200000-4242-4242-8242-424242424242','a4200001-4242-4242-8242-424242424242','owner');
insert into public.friendships(requester_id,addressee_id,status,accepted_at) values('a4200001-4242-4242-8242-424242424242','a4200002-4242-4242-8242-424242424242','accepted',now());
set local role service_role;
do $$ declare invite uuid; link text; r jsonb; begin
 perform public.group_invite_members('a4200001-4242-4242-8242-424242424242','a4200000-4242-4242-8242-424242424242',array['a4200002-4242-4242-8242-424242424242']::uuid[]);
 select id into invite from public.group_invitations where group_id='a4200000-4242-4242-8242-424242424242';
 perform public.notify_insert(array['a4200002-4242-4242-8242-424242424242']::uuid[],'group_invite',null,jsonb_build_object('inviteId',invite));
 -- Exercise the real bearer-link join path, not invitation acceptance.
 link:=public.invite_create('a4200001-4242-4242-8242-424242424242','group','a4200000-4242-4242-8242-424242424242',null)->>'token';
 perform public.invite_accept(link,'a4200002-4242-4242-8242-424242424242');
 if not exists(select 1 from public.group_members where group_id='a4200000-4242-4242-8242-424242424242' and user_id='a4200002-4242-4242-8242-424242424242') then raise exception 'Link did not join'; end if;
 perform public.group_remove_member('a4200001-4242-4242-8242-424242424242','a4200000-4242-4242-8242-424242424242','a4200002-4242-4242-8242-424242424242');
 begin perform public.group_invitation_resolve('a4200002-4242-4242-8242-424242424242',invite,'accepted'); raise exception 'Old pending invite re-added removed member'; exception when sqlstate 'PT409' then null; end;
 if exists(select 1 from public.notifications where user_id='a4200002-4242-4242-8242-424242424242' and type='group_invite' and read_at is null) then raise exception 'Stale invite remains unread'; end if;
 -- Removal invalidates direct requests, never changes bearer-link policy.
 perform public.invite_accept(link,'a4200002-4242-4242-8242-424242424242');
 if not exists(select 1 from public.group_members where group_id='a4200000-4242-4242-8242-424242424242' and user_id='a4200002-4242-4242-8242-424242424242') then raise exception 'Link rejoin changed'; end if;
end $$;
select 'ok 1 - invite/link join/removal/old acceptance is denied; bearer joins preserved';
do $$ declare i uuid; begin
 perform public.group_remove_member('a4200001-4242-4242-8242-424242424242','a4200000-4242-4242-8242-424242424242','a4200002-4242-4242-8242-424242424242');
 perform public.group_invite_members('a4200001-4242-4242-8242-424242424242','a4200000-4242-4242-8242-424242424242',array['a4200002-4242-4242-8242-424242424242']::uuid[]);
 select id into i from public.group_invitations where group_id='a4200000-4242-4242-8242-424242424242' and status='pending';
 perform public.group_invitation_resolve('a4200002-4242-4242-8242-424242424242',i,'accepted');
 perform public.group_invitation_resolve('a4200002-4242-4242-8242-424242424242',i,'accepted');
end $$;
select 'ok 2 - fresh owner invitations and accepted retry remain valid';
select set_config('test.pr42.dm',(public.direct_chat('open','a4200001-4242-4242-8242-424242424242','a4200002-4242-4242-8242-424242424242')->>'id'),true);
do $$ declare n integer; begin
 for n in 1..10 loop
  if n%2=0 then perform public.direct_chat('send','a4200001-4242-4242-8242-424242424242',current_setting('test.pr42.dm')::uuid,jsonb_build_object('body','Hi','clientId','pr42-send-'||n));
  else perform public.group_chat('send','a4200001-4242-4242-8242-424242424242','a4200000-4242-4242-8242-424242424242',jsonb_build_object('body','Hi','clientId','pr42-send-'||n)); end if;
 end loop;
 begin perform public.group_chat('send','a4200001-4242-4242-8242-424242424242','a4200000-4242-4242-8242-424242424242','{"body":"No","clientId":"pr42-send-11"}'); raise exception 'Group burst allowed'; exception when sqlstate 'PT429' then null; end;
 begin perform public.direct_chat('send','a4200001-4242-4242-8242-424242424242',current_setting('test.pr42.dm')::uuid,'{"body":"No","clientId":"pr42-send-11"}'); raise exception 'DM burst allowed'; exception when sqlstate 'PT429' then null; end;
 if (select count(*) from public.rate_limit_events where action='message_send' and user_id='a4200001-4242-4242-8242-424242424242')<>10 then raise exception 'Quota not atomic'; end if;
end $$;
select 'ok 3 - shared sender burst cap across transports; rejected sends do not count';
do $$ declare r jsonb; n integer; begin
 r:=public.group_chat('send','a4200001-4242-4242-8242-424242424242','a4200000-4242-4242-8242-424242424242','{"body":"Hi","clientId":"pr42-send-1"}');
 perform public.direct_chat('send','a4200001-4242-4242-8242-424242424242',current_setting('test.pr42.dm')::uuid,'{"body":"Hi","clientId":"pr42-send-2"}');
 begin perform public.group_chat('send','a4200001-4242-4242-8242-424242424242','a4200000-4242-4242-8242-424242424242','{"body":"Changed","clientId":"pr42-send-1"}'); raise exception 'Conflict swallowed'; exception when sqlstate 'PT409' then null; end;
 if (select count(*) from public.rate_limit_events where action='message_send' and user_id='a4200001-4242-4242-8242-424242424242')<>10 then raise exception 'Retries counted'; end if;
 for n in 1..2 loop
  if (select count(*) from public.notify_insert(array['a4200002-4242-4242-8242-424242424242']::uuid[],'group_message',null,jsonb_build_object('messageId',r->'message'->>'id')))<>(case when n=1 then 1 else 0 end) then raise exception 'Retry amplified notification'; end if;
 end loop;
end $$;
select 'ok 4 - capped sender can retry; content conflicts remain 409; notification dedup preserved';
-- Move quota events into older windows instead of sleeping during this test.
update public.rate_limit_events set created_at=clock_timestamp()-interval '20 seconds' where user_id='a4200001-4242-4242-8242-424242424242' and action='message_send';
insert into public.rate_limit_events(user_id,action,created_at) select 'a4200001-4242-4242-8242-424242424242','message_send',clock_timestamp()-interval '20 seconds' from generate_series(1,50);
do $$ begin
 begin perform public.group_chat('send','a4200001-4242-4242-8242-424242424242','a4200000-4242-4242-8242-424242424242','{"body":"No","clientId":"pr42-minute"}'); raise exception 'Minute cap bypassed'; exception when sqlstate 'PT429' then null; end;
end $$;
update public.rate_limit_events set created_at=clock_timestamp()-interval '2 minutes' where user_id='a4200001-4242-4242-8242-424242424242' and action='message_send';
insert into public.rate_limit_events(user_id,action,created_at) select 'a4200001-4242-4242-8242-424242424242','message_send',clock_timestamp()-interval '2 minutes' from generate_series(1,440);
do $$ begin
 begin perform public.direct_chat('send','a4200001-4242-4242-8242-424242424242',current_setting('test.pr42.dm')::uuid,'{"body":"No","clientId":"pr42-hourly"}'); raise exception 'Hour cap bypassed'; exception when sqlstate 'PT429' then null; end;
end $$;
select 'ok 5 - sustained minute and hourly limits apply to both transports';
update public.rate_limit_events set created_at=clock_timestamp()-interval '2 hours' where user_id='a4200001-4242-4242-8242-424242424242' and action='message_send';
select public.group_chat('send','a4200001-4242-4242-8242-424242424242','a4200000-4242-4242-8242-424242424242','{"body":"Recovered","clientId":"pr42-recover"}');
select public.group_chat('send','a4200002-4242-4242-8242-424242424242','a4200000-4242-4242-8242-424242424242','{"body":"Independent sender","clientId":"pr42-sender2"}');
select 'ok 6 - expired quota recovers; other senders are independent';
do $$ begin
 begin perform public.group_chat('list','a4200003-4242-4242-8242-424242424242','a4200000-4242-4242-8242-424242424242'); raise exception 'Outsider read chat'; exception when sqlstate 'PT404' then null; end;
 begin perform public.group_ideas('list','a4200003-4242-4242-8242-424242424242','a4200000-4242-4242-8242-424242424242'); raise exception 'Outsider read ideas'; exception when sqlstate 'PT404' then null; end;
 begin perform public.direct_chat('list','a4200003-4242-4242-8242-424242424242',current_setting('test.pr42.dm')::uuid); raise exception 'Outsider read DM'; exception when sqlstate 'PT404' then null; end;
 if public.group_ideas('list','a4200001-4242-4242-8242-424242424242','a4200000-4242-4242-8242-424242424242')<>'[]'::jsonb then raise exception 'Empty list wrong'; end if;
 begin perform public.group_ideas('get','a4200001-4242-4242-8242-424242424242','a4200000-4242-4242-8242-424242424242',gen_random_uuid()); raise exception 'Missing idea returned'; exception when sqlstate 'PT404' then null; end;
end $$;
select 'ok 7 - lock-free reads retain unavailable-resource authorization and empty/get semantics';
select public.group_remove_member('a4200001-4242-4242-8242-424242424242','a4200000-4242-4242-8242-424242424242','a4200002-4242-4242-8242-424242424242');
select public.friend_remove('a4200001-4242-4242-8242-424242424242','a4200002-4242-4242-8242-424242424242');
do $$ begin
 begin perform public.group_chat('list','a4200002-4242-4242-8242-424242424242','a4200000-4242-4242-8242-424242424242'); raise exception 'Removed member read'; exception when sqlstate 'PT404' then null; end;
 begin perform public.direct_chat('list','a4200001-4242-4242-8242-424242424242',current_setting('test.pr42.dm')::uuid); raise exception 'Unfriended read'; exception when sqlstate 'PT404' then null; end;
end $$;
select 'ok 8 - committed membership/friendship removal revokes reads';
rollback;
