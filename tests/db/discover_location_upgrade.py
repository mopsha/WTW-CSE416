"""Test the real pre-0061 chain in an empty disposable local PostgreSQL database.

The database needs Supabase's auth/storage schemas. For a PostgreSQL-only test,
--isolated-bootstrap supplies local service stubs instead of the three managed
extensions. --parallel-migration accepts reserved 0058–0060 files on other branches.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import subprocess
from urllib.parse import urlparse
from uuid import uuid4


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dsn', required=True)
    parser.add_argument('--parallel-migration', type=Path, action='append', default=[])
    parser.add_argument('--isolated-bootstrap', type=Path)
    args = parser.parse_args()
    parsed = urlparse(args.dsn)
    local_socket = args.dsn.startswith('host=/tmp/') and ' host=' not in args.dsn and 'hostaddr=' not in args.dsn
    local_url = (parsed.scheme in ('postgres', 'postgresql')
                 and parsed.hostname in ('localhost', '127.0.0.1', '::1')
                 and not parsed.query and not parsed.fragment)
    if not (local_socket or local_url):
        parser.error('Use an empty disposable local database only.')

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

    run("do $$ begin if to_regclass('public.picks') is not null then raise exception 'Database must be empty'; end if; end $$;")
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

    run(file=root / 'tests/db/discover_location_upgrade.sql')
    print('PASS: 0061 preserves the existing password bucket, admits another reservation, and enforces both quotas')
    print(run(file=root / 'supabase/tests/discover_location_limit_test.sql'))

    accounts = (uuid4(), uuid4())
    run(
        "insert into public.rate_limit_counters(scope,subject,bucket,calls) values "
        + ','.join(f"('discover_location','{account}','2000-01-01',60)" for account in accounts)
    )

    def reserve(index):
        account = accounts[index % len(accounts)]
        return account, run(
            f"set role service_role; select public.consume_user_limit('discover_location','{account}');"
        )

    with ThreadPoolExecutor(max_workers=12) as pool:
        first = pool.submit(reserve, 0)
        cleanup = pool.submit(run, 'set role service_role; select public.purge_discover_location_limits();')
        remaining = pool.map(reserve, range(1, 160))
        reservations = [first.result(), *remaining]
        if cleanup.result() != '2':
            raise AssertionError('Concurrent sweep did not remove both expired buckets')
    for account in accounts:
        outcomes = [value for owner, value in reservations if owner == account]
        if outcomes.count('t') != 60 or outcomes.count('f') != 20:
            raise AssertionError('A concurrent account did not receive exactly 60 of 80 attempts')
    print('PASS: concurrent quota enforcement admits exactly 60 of 80 requests for each account')


if __name__ == '__main__':
    main()
