-- Real profiles/upsert coverage supersedes the former synthetic trigger fixture.
begin;
select '1..1';
insert into auth.users(id,email,raw_user_meta_data) values ('a0360099-3333-4333-8333-333333333333','legacy-review@example.invalid','{}');
alter table public.profiles disable trigger normalize_profile_username;
update public.profiles set username='admin',display_name='Legacy' where id='a0360099-3333-4333-8333-333333333333';
alter table public.profiles enable trigger normalize_profile_username;
set local role service_role;
insert into public.profiles(id,username,display_name) values('a0360099-3333-4333-8333-333333333333','admin','Legacy')
 on conflict(id) do update set username=excluded.username,share_profile_metadata=false;
do $$ begin
 begin update public.profiles set username='support' where id='a0360099-3333-4333-8333-333333333333'; raise exception 'Reserved switch'; exception when sqlstate 'PT400' then null; end;
end $$;
select 'ok 1 - production profiles upsert preserves legacy username while rejecting reserved switches';
rollback;
