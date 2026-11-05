begin;
select '1..2';
create temporary table legacy_username_fixture(username text, share_metadata boolean);
insert into legacy_username_fixture values('admin',true);
create trigger validate_legacy before insert or update of username on legacy_username_fixture
 for each row execute function private.normalize_profile_username();
do $$ begin
 update legacy_username_fixture set username='admin',share_metadata=false;
 if (select share_metadata from legacy_username_fixture) then raise exception 'Legacy metadata edit failed'; end if;
end $$;
select 'ok 1 - production trigger preserves unchanged legacy reserved handles';
do $$ begin
 begin update legacy_username_fixture set username='support'; raise exception 'Different reserved handle allowed'; exception when sqlstate 'PT400' then null; end;
 begin insert into legacy_username_fixture values('admin',false); raise exception 'New reserved claim allowed'; exception when sqlstate 'PT400' then null; end;
end $$;
select 'ok 2 - production trigger still rejects new and switched reserved claims';
rollback;
