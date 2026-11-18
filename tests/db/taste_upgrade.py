"""Build a disposable pre-0049 schema, then test a taste privacy/generation upgrade.

Use an empty local database with Supabase auth/storage schemas already available.
Pass --parallel-migration for reserved 0048 snapshots. --isolated-bootstrap
is only for PostgreSQL-only harnesses; it supplies service stubs and omits the
0007 extension installations, so it is not full Supabase integration.
"""
import argparse
from pathlib import Path
import subprocess
from urllib.parse import urlparse

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--dsn', required=True)
parser.add_argument('--parallel-migration', type=Path, action='append', default=[])
parser.add_argument('--isolated-bootstrap', type=Path)
parser.add_argument('--legacy-cache-schema', action='store_true', help='Also emulate the earlier 0047 FK/no-timestamp cache schema.')
args = parser.parse_args()
if not ('host=/tmp/' in args.dsn or urlparse(args.dsn).hostname in ('localhost', '127.0.0.1', '::1')):
    parser.error('Use an empty disposable local database only.')
root = Path(__file__).resolve().parents[2]
base = ['psql', '-X', args.dsn, '-v', 'ON_ERROR_STOP=1']

def run(sql):
    result = subprocess.run(base, input=sql, capture_output=True, text=True, timeout=180)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout

run("do $$ begin if to_regclass('public.picks') is not null then raise exception 'Database must be empty'; end if; end $$;")
if args.isolated_bootstrap:
    run(args.isolated_bootstrap.read_text())
files = [p for p in sorted((root / 'supabase/migrations').glob('*.sql')) if p.name[:4] < '0049']
for extra in args.parallel_migration:
    if extra.name[:4] not in ('0048',) or any(p.name[:4] == extra.name[:4] for p in files):
        parser.error('Parallel migrations must be unique 0048 files.')
    files.append(extra)
for path in sorted(files, key=lambda p: p.name):
    sql = path.read_text()
    if args.isolated_bootstrap and path.name.startswith('0007'):
        sql = '\n'.join(line for line in sql.splitlines() if not line.lower().startswith('create extension'))
    run(sql)
fixture_args = ['-v', 'legacy_cache_schema=true'] if args.legacy_cache_schema else []
result = subprocess.run(base + fixture_args + ['-f', str(root / 'tests/db/taste_upgrade.sql')], capture_output=True, text=True, timeout=120)
if result.returncode:
    raise RuntimeError(result.stderr)
print(result.stdout)
print(result.stderr)
print('PASS: pre-0049 taste privacy/generation upgrade; chain:', ', '.join(p.name[:4] for p in sorted(files, key=lambda p: p.name)), '-> 0049')
