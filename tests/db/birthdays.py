"""Isolated PostgreSQL migration/authorization checks. No hosted project access.
Auth, Storage and cron are minimal stand-ins; this does not prove hosted behavior.
Requires PostgreSQL tools on PATH. No Docker, Supabase secrets or network needed.
"""
import pathlib
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]

def run(args, **kwargs):
    result = subprocess.run(args, capture_output=True, text=True, timeout=60, **kwargs)
    if result.returncode:
        raise RuntimeError(result.stderr + result.stdout[-3000:])
    return result.stdout

with tempfile.TemporaryDirectory(prefix='wtw-bday-', dir='/private/tmp') as directory:
    work = pathlib.Path(directory)
    data = str(work / 'data')
    base = ['psql', '-h', directory, '-p', '55483', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1']
    run(['initdb', '-D', data, '-U', 'postgres', '-A', 'trust'])
    started = False
    try:
        run(['pg_ctl', '-D', data, '-l', str(work/'server.log'), '-o', f'-k {directory} -p 55483 -h ""', '-w', 'start'])
        started = True
        run(base, input="""
create schema cron; create function cron.schedule(text,text,text) returns bigint language sql as $$ select 1::bigint $$;
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create schema storage; create schema extensions;
create extension pgcrypto with schema extensions; grant usage on schema extensions to anon,authenticated,service_role;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to anon,authenticated,service_role;
grant execute on function auth.uid() to anon,authenticated,service_role;
grant all on auth.users to service_role;
create table storage.buckets(id text primary key,name text not null,public boolean default false,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid default gen_random_uuid() primary key,bucket_id text references storage.buckets(id),name text,created_at timestamptz default now());
alter table storage.objects enable row level security; alter table storage.buckets enable row level security;
grant usage on schema storage to anon,authenticated,service_role;
grant all on storage.objects,storage.buckets to anon,authenticated,service_role;
""")
        for migration in sorted((ROOT/'supabase/migrations').glob('*.sql')):
            if migration.name == '0038_profile_birthdays.sql':
                run(base, input="insert into auth.users(id,email) values('b0380099-3333-4333-8333-333333333333','legacy-birthday@example.invalid');")
            source = migration.read_text()
            if migration.name == '0007_deadline_sweep.sql':
                source = '\n'.join(line for line in source.splitlines() if not line.startswith('create extension'))
            run(base, input=source)
        run(base, input="""
do $$ begin
 if (select birthday_required from public.profiles where id='b0380099-3333-4333-8333-333333333333') then raise exception 'Legacy profile forced into birthday setup'; end if;
 if exists(select 1 from private.profile_birthdays) then raise exception 'Invented birthday backfill'; end if;
 update public.profiles set optional_setup_pending=false,preferences_updated_at=now() where id='b0380099-3333-4333-8333-333333333333';
end $$;
""")
        print('PASS all migrations through 0038; existing profile remains exempt with no invented birthday', flush=True)
        for name in ['user_profiles_test.sql', 'birthdays_test.sql', 'auth_identity_setup_test.sql', 'integration_identity_guard_test.sql', 'username_discovery_test.sql', 'username_reserved_legacy_test.sql', 'username_review_fixes_test.sql', 'photo_moderation_readiness_test.sql']:
            result = run(base + ['-f', str(ROOT/'supabase/tests'/name)])
            if 'not ok' in result:
                raise RuntimeError(result)
            print('PASS ' + name, flush=True)
    finally:
        if started:
            run(['pg_ctl', '-D', data, '-m', 'fast', '-w', 'stop'])
