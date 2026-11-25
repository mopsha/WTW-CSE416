"""Test the 0061/0062 upgrade in a disposable local PostgreSQL database.

Pass --pre-migrated after a local Supabase reset through the last pre-0061
migration without seed data. Otherwise this script applies the preceding
migrations to an empty database with Supabase's auth/storage schemas.
For a PostgreSQL-only test,
--isolated-bootstrap supplies local service stubs instead of the three managed
extensions. --parallel-migration accepts reserved 0058–0060 files on other branches.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import shlex
import subprocess
from urllib.parse import urlparse
from uuid import uuid4


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dsn', required=True)
    parser.add_argument('--parallel-migration', type=Path, action='append', default=[])
    parser.add_argument('--isolated-bootstrap', type=Path)
    parser.add_argument('--pre-migrated', action='store_true')
    args = parser.parse_args()
    if args.pre_migrated and (args.isolated_bootstrap or args.parallel_migration):
        parser.error('--pre-migrated cannot be combined with migration setup options.')
    parsed = urlparse(args.dsn)
    options = dict(part.split('=', 1) for part in shlex.split(args.dsn) if '=' in part)
    local_socket = (options.get('host', '').startswith(('/tmp/', '/private/tmp/'))
                    and ',' not in options['host'] and 'hostaddr' not in options)
    local_url = (parsed.scheme in ('postgres', 'postgresql')
                 and parsed.hostname in ('localhost', '127.0.0.1', '::1')
                 and not parsed.query and not parsed.fragment)
    if not (local_socket or local_url):
        parser.error('Use a disposable local database only.')

    root = Path(__file__).resolve().parents[2]
    psql = ['psql', '-X', args.dsn, '-qAt', '-v', 'ON_ERROR_STOP=1']

    def run(sql=None, *, file=None):
        result = subprocess.run(
            psql + (['-f', str(file)] if file else []),
            input=sql, capture_output=True, text=True, timeout=120,
        )
        if result.returncode:
            raise RuntimeError(result.stderr)
        return result.stdout.strip()

    if not args.pre_migrated:
        run("do $$ begin if to_regclass('public.picks') is not null then raise exception 'Database must be empty'; end if; end $$;")
        apply_preceding_migrations(args, root, parser, run)
    run("""
        do $$ begin
          if to_regprocedure('public.consume_login_limit(text[],integer[])') is null
             or to_regprocedure('public.purge_discover_location_limits()') is not null
             or exists (select 1 from public.provider_usage)
             or exists (select 1 from public.rate_limit_counters) then
            raise exception 'Expected an unseeded disposable pre-0061 database';
          end if;
        end $$;
    """)
    run(file=root / 'tests/db/discover_location_upgrade.sql')
    print('PASS: upgrade preserves existing password and provider usage and enforces location limits')
    print(run(file=root / 'supabase/tests/discover_location_limit_test.sql'))
    check_concurrent_usage(run)


def apply_preceding_migrations(args, root, parser, run):
    if args.isolated_bootstrap:
        run(file=args.isolated_bootstrap)

    migrations = {
        path.name[:4]: path
        for path in sorted((root / 'supabase/migrations').glob('*.sql'))
        if path.name[:4] < '0061'
    }
    for path in args.parallel_migration:
        version = path.name[:4]
        if version not in ('0058', '0059', '0060') or version in migrations:
            parser.error('Parallel migrations must be unique 0058–0060 files.')
        migrations[version] = path
    managed = ('pg_cron', 'pg_net', 'supabase_vault')
    for version, path in sorted(migrations.items()):
        if args.isolated_bootstrap and version == '0007':
            run('\n'.join(
                line for line in path.read_text().splitlines()
                if not (line.lstrip().lower().startswith('create extension')
                        and any(name in line.lower() for name in managed))
            ))
        else:
            run(file=path)


def check_concurrent_usage(run):
    accounts = (uuid4(), uuid4())

    def reserve(index):
        account = accounts[index % len(accounts)]
        return account, run(
            f"""set role service_role;
            select case when public.consume_user_limit('discover_location','{account}')
              then case when public.consume_location_provider_call(100) then 'provider' else 'account' end
              else 'denied' end;"""
        )

    try:
        run(
            "insert into public.rate_limit_counters(scope,subject,bucket,calls) values "
            + ','.join(f"('discover_location','{account}','2000-01-01',60)" for account in accounts)
        )
        with ThreadPoolExecutor(max_workers=8) as pool:
            first = pool.submit(reserve, 0)
            cleanup = pool.submit(run, 'set role service_role; select public.purge_discover_location_limits();')
            core = pool.submit(run, 'set role service_role; select public.consume_provider_call(100);')
            reservations = [first.result(), *pool.map(reserve, range(1, 160))]
            if cleanup.result() != '2' or core.result() != 't':
                raise AssertionError('Concurrent cleanup or core provider reservation failed')
        for account in accounts:
            outcomes = [value for owner, value in reservations if owner == account]
            if outcomes.count('denied') != 20:
                raise AssertionError('A concurrent account did not receive exactly 60 of 80 attempts')
        if sum(value == 'provider' for _, value in reservations) != 10:
            raise AssertionError('Concurrent accounts did not share exactly 10 location provider calls')
        run("""
            set role service_role;
            do $$ begin
              for i in 1..89 loop
                if not public.consume_provider_call(100) then
                  raise exception 'Core could not use all 90 calls left by location discovery';
                end if;
              end loop;
              if public.consume_provider_call(100) or public.consume_location_provider_call(100) then
                raise exception 'Concurrent reservations exceeded the aggregate cap';
              end if;
            end $$;
        """)
        print('PASS: concurrent accounts share 10 location calls and leave 90 core calls')
    finally:
        run(f"""
            delete from public.rate_limit_counters where scope = 'discover_location'
              and subject in ('{accounts[0]}', '{accounts[1]}');
            delete from public.provider_usage where provider = 'google';
        """)


if __name__ == '__main__':
    main()
