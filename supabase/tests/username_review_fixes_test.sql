begin;
select '1..5';
insert into auth.users(id,email,raw_user_meta_data) values
 ('a0370001-3333-4333-8333-333333333333','review-one@example.invalid','{}'),
 ('a0370002-3333-4333-8333-333333333333','review-two@example.invalid','{}'),
 ('a0370003-3333-4333-8333-333333333333','review-three@example.invalid','{}');
update public.profiles set display_name='Review',username=case id
 when 'a0370001-3333-4333-8333-333333333333' then 'review_one'
 when 'a0370002-3333-4333-8333-333333333333' then 'review_two' else 'review_three' end
 where id::text like 'a037%';
set local role service_role;
do $$ declare a uuid:='a0370001-3333-4333-8333-333333333333'; b uuid:='a0370002-3333-4333-8333-333333333333'; begin
 -- A historical email-created request exists, but neither new discovery route
 -- exposes its outgoing state to the email-probing sender.
 perform public.friend_request(a,'review-two@example.invalid');
 if public.person_lookup(a,b)->>'relationship'<>'none' then raise exception 'Historical email oracle'; end if;
 if public.username_search(a,'review_two')->0->>'relationship'<>'none' then raise exception 'Search email oracle'; end if;
 if public.person_lookup(b,a)->>'relationship'<>'incoming' then raise exception 'Valid request lost'; end if;
 perform public.friend_accept(b,a);
 if public.person_lookup(a,b)->>'relationship'<>'friends' then raise exception 'Accepted friend lost'; end if;
 perform public.friend_remove(a,b);
end $$;
select 'ok 1 - historical email requests are concealed without deleting pending or accepted friendships';
do $$ declare a uuid:='a0370001-3333-4333-8333-333333333333'; b uuid:='a0370002-3333-4333-8333-333333333333'; n integer; begin
 select count(*) into n from public.rate_limit_events where user_id=a and action='friend_request';
 begin perform public.friend_request_username(a,'review_one',a); raise exception 'Self succeeded'; exception when sqlstate 'PT400' then null; end;
 begin perform public.friend_request_username(a,'old_name',b); raise exception 'Stale username succeeded'; exception when sqlstate 'PT404' then null; end;
 update public.profiles set avatar_deletion_pending=true where id=b;
 begin perform public.friend_request_username(a,'review_two',b); raise exception 'Deleting target succeeded'; exception when sqlstate 'PT404' then null; end;
 update public.profiles set avatar_deletion_pending=false where id=b;
 perform public.block_user(b,a);
 begin perform public.friend_request_username(a,'review_two',b); raise exception 'Block succeeded'; exception when sqlstate 'PT404' then null; end;
 perform public.unblock_user(b,a);
 if n<>(select count(*) from public.rate_limit_events where user_id=a and action='friend_request') then raise exception 'Invalid request spent quota'; end if;
 if public.friend_request_username(a,'review_two',b)->>'relationship'<>'requested' then raise exception 'Not confirmed'; end if;
 perform public.friend_request_username(a,'review_two',b);
 if n+1<>(select count(*) from public.rate_limit_events where user_id=a and action='friend_request') then raise exception 'Duplicate quota'; end if;
end $$;
select 'ok 2 - accurate errors and confirmed UUID-bound requests preserve quota and idempotency';
do $$ declare a uuid:='a0370003-3333-4333-8333-333333333333'; begin
 insert into private.username_lookup_events(user_id,created_at) select a,now()-interval '2 hours' from generate_series(1,149);
 perform public.username_search(a,'review');
 begin perform public.person_lookup(a,'a0370001-3333-4333-8333-333333333333'); raise exception 'Daily route bypass'; exception when sqlstate 'PT429' then null; end;
 if (select count(*) from private.username_lookup_events where user_id=a)<>150 then raise exception 'Wrong daily total'; end if;
 delete from private.username_lookup_events where user_id=a;
 insert into private.username_lookup_events(user_id,created_at) select a,now()-interval '24 hours' from generate_series(1,150);
 perform public.person_lookup(a,'a0379999-3333-4333-8333-333333333333');
 if (select count(*) from private.username_lookup_events where user_id=a)<>1 then raise exception 'Rolling reset failed'; end if;
 for i in 1..28 loop perform public.person_lookup(a,'a0379999-3333-4333-8333-333333333333'); end loop;
 begin perform public.username_search(a,'review'); raise exception 'Minute bypass'; exception when sqlstate 'PT429' then null; end;
end $$;
select 'ok 3 - minute and rolling daily quotas share both routes including missing targets';
reset role;
-- Fixture-only legacy state, created before this PR's claim validation existed.
alter table public.profiles disable trigger normalize_profile_username;
update public.profiles set username='admin' where id='a0370003-3333-4333-8333-333333333333';
alter table public.profiles enable trigger normalize_profile_username;
set local role service_role;
do $$ begin
 insert into public.profiles(id,username,display_name) values('a0370003-3333-4333-8333-333333333333','admin','Review')
 on conflict(id) do update set username=excluded.username,share_profile_metadata=true;
 perform public.user_profile_update('a0370003-3333-4333-8333-333333333333','{"username":"admin","shareMetadata":false}');
 begin update public.profiles set username='support' where id='a0370003-3333-4333-8333-333333333333'; raise exception 'Reserved switch'; exception when sqlstate 'PT400' then null; end;
end $$;
select 'ok 4 - real upsert and metadata RPC preserve legacy reserved usernames';
do $$ begin
 if has_table_privilege('authenticated','private.username_lookup_events','SELECT') or has_function_privilege('authenticated','public.friend_request_username(uuid,text,uuid)','EXECUTE') then raise exception 'Privileged access exposed'; end if;
end $$;
select 'ok 5 - server-only accounting and writes remain restricted';
rollback;
