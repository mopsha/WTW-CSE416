"""Photo CAS and deletion races on a disposable migrated PostgreSQL database.

Creates real small Storage fixtures through the local Storage API, and removes
them through that API. Broader authorization tests live in tests/api/avatars.test.mjs.
"""
import argparse
import concurrent.futures
import subprocess
import time
import uuid
from pathlib import Path
from urllib.parse import urlparse

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--dsn', required=True)
args = parser.parse_args()
# Match localConfig's fixed loopback API: never mix a hosted DB with local Storage.
parsed_dsn = urlparse(args.dsn)
if (parsed_dsn.scheme not in ('postgres', 'postgresql')
        or parsed_dsn.hostname not in ('localhost', '127.0.0.1')
        or parsed_dsn.port != 54322 or parsed_dsn.path != '/postgres'
        or parsed_dsn.query or parsed_dsn.fragment):
    parser.error('Expected disposable local Supabase PostgreSQL on port 54322')
base = ['psql', args.dsn, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1']
user = str(uuid.uuid4())
paths = [f'{user}/{uuid.uuid4()}.jpg' for _ in range(2)]


def query(sql, check=True):
    result = subprocess.run(base, input=sql, text=True, capture_output=True, timeout=15)
    if check and result.returncode:
        raise AssertionError(result.stderr)
    return result


def storage_fixtures(action):
    helper = Path(__file__).with_name('avatar_storage_fixtures.mjs')
    result = subprocess.run(['node', str(helper), action, *paths],
                            text=True, capture_output=True, timeout=45)
    if result.returncode:
        raise AssertionError(result.stderr)


user_created = False
storage_started = False
try:
    query(f"""
      insert into auth.users(id,raw_user_meta_data) values('{user}','{{"display_name":"Photo race"}}');
    """)
    user_created = True
    storage_started = True  # Also clean up if only the first upload succeeds.
    storage_fixtures('create')
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(query,
            f"set role service_role; select public.avatar_change('{user}',0,'{path}');", False)
            for path in paths]
        results = [future.result() for future in futures]
    assert sum(result.returncode == 0 for result in results) == 1, 'CAS must have one winner'
    assert any('Photo changed' in result.stderr for result in results), 'Loser must conflict'
    assert query(f"select avatar_revision from public.profiles where id='{user}';").stdout.strip() == '1'
    active = query(f"select avatar_path from public.profiles where id='{user}';").stdout.strip()
    assert active in paths

    # Observe the deletion transaction holding the row lock before submitting a
    # competing update. This exercises PostgreSQL wait/recheck, not a mock lock.
    app_name = f'avatar_delete_{uuid.uuid4().hex}'
    holder = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                              stderr=subprocess.PIPE, text=True)
    try:
        holder.stdin.write(f"set application_name='{app_name}'; begin; set role service_role; "
                           f"select public.avatar_begin_account_delete('{user}'); "
                           "select pg_sleep(2); commit;\n")
        holder.stdin.close()
        for _ in range(100):
            if query(f"select count(*) from pg_stat_activity where application_name='{app_name}' and wait_event='PgSleep';").stdout.strip() == '1':
                break
            time.sleep(0.01)
        else:
            raise AssertionError('Deletion lock holder never became ready')
        result = query(f"set role service_role; select public.avatar_change('{user}',1,null);", False)
        assert result.returncode != 0 and 'Photo changed' in result.stderr, 'Deletion must reject pending update'
        assert holder.wait(timeout=5) == 0
    finally:
        if holder.poll() is None:
            holder.terminate()
            holder.wait(timeout=5)
    result = query(f"set role service_role; select public.avatar_read('{user}','{user}',2);", False)
    assert result.returncode != 0 and 'Photo unavailable' in result.stderr
    assert query(f"select avatar_path from public.profiles where id='{user}';").stdout.strip() == active
    print('PASS concurrent replacements: one winner; deletion race: no late mutation or photo read')
finally:
    # Separate connections require committed fixtures, so one enclosing rollback
    # cannot clean this test. Remove binaries and metadata through Storage instead.
    try:
        if storage_started:
            storage_fixtures('remove')
            remaining = query(f"select count(*) from storage.objects where bucket_id='profile-photos' "
                              f"and name in ('{paths[0]}','{paths[1]}');").stdout.strip()
            assert remaining == '0', 'Storage fixture metadata remained after API cleanup'
    finally:
        if user_created:
            query(f"delete from auth.users where id='{user}';")
