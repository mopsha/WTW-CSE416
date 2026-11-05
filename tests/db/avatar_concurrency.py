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
from photo_moderation_races import exercise_photo_moderation_races, exercise_mutual_photo_reports

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
reporter = str(uuid.uuid4())
other_reporter = str(uuid.uuid4())
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
reporter_created = False
other_reporter_created = False
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

    # Two concurrent transactions share one atomic per-viewer resolution cap.
    quota_sql = f"""begin; set local role service_role;
      select sum(public.consume_avatar_limit('{user}','avatar_resolve')::int)
      from generate_series(1,70); commit;"""
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        usage = list(pool.map(lambda _: query(quota_sql).stdout.strip(), range(2)))
    buckets = query(f"select calls from public.rate_limit_counters where scope='avatar_resolve' "
                    f"and subject='{user}';").stdout.split()
    assert all(int(value) <= 120 for value in buckets), 'Concurrent quota exceeded'
    assert sum(int(value) for value in buckets) == sum(int(value) for value in usage), 'Quota undercounted'
    if len(buckets) == 1:
        assert sum(int(value) for value in usage) == 120, 'Concurrent cap not enforced'

    # Real Storage fixtures plus two PostgreSQL connections: report pins revision 1
    # before retirement, or retirement wins and reporting must return PT404.
    query(f"insert into auth.users(id,raw_user_meta_data) values('{reporter}','{{}}');")
    reporter_created = True
    query(f"insert into public.friendships(requester_id,addressee_id,status,accepted_at) "
          f"values('{reporter}','{user}','accepted',now());")
    query(f"insert into auth.users(id,raw_user_meta_data) values('{other_reporter}','{{}}');")
    other_reporter_created = True
    query(f"insert into public.friendships(requester_id,addressee_id,status,accepted_at) values('{other_reporter}','{user}','accepted',now());")
    retention = query("select coalesce(retention_seconds::text,'null') from private.photo_moderation_config;").stdout.strip()
    assert retention == 'null' or retention.isdigit()
    readiness = query("select moderation_ready from private.photo_moderation_config;").stdout.strip()
    assert readiness in ('t','f')
    try:
        query("update private.photo_moderation_config set retention_seconds=3600,moderation_ready=true;")  # Test fixture, not policy.
        replacement_path = next(path for path in paths if path != active)
        exercise_photo_moderation_races(query, base, user, reporter, active, replacement_path, other_reporter)
        # Reuse one retired fixture for the reporter's own current photo.
        reporter_path = f'{reporter}/{uuid.uuid4()}.jpg'
        paths.append(reporter_path)
        extra = subprocess.run(['node', str(Path(__file__).with_name('avatar_storage_fixtures.mjs')), 'create', reporter_path], text=True, capture_output=True, timeout=45)
        assert extra.returncode == 0, extra.stderr
        query(f"select public.avatar_change('{reporter}',0,'{reporter_path}');")
        exercise_mutual_photo_reports(query, base, user, reporter)
    finally:
        query(f"update private.photo_moderation_config set retention_seconds={retention},moderation_ready={'true' if readiness=='t' else 'false'};")
    current_revision = int(query(f"select avatar_revision from public.profiles where id='{user}';").stdout.strip())

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
        result = query(f"set role service_role; select public.avatar_change('{user}',{current_revision},null);", False)
        assert result.returncode != 0 and 'Photo changed' in result.stderr, 'Deletion must reject pending update'
        assert holder.wait(timeout=5) == 0
    finally:
        if holder.poll() is None:
            holder.terminate()
            holder.wait(timeout=5)
    result = query(f"set role service_role; select public.avatar_read('{user}','{user}',{current_revision + 1});", False)
    assert result.returncode != 0 and 'Photo unavailable' in result.stderr
    assert query(f"select avatar_path from public.profiles where id='{user}';").stdout.strip() == active
    # Durable retry claims must not hand the same deletion to concurrent workers.
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        claims = list(pool.map(lambda _: query("set role service_role; select public.avatar_pending_deletions();").stdout, range(2)))
    assert sum(user in claim for claim in claims) == 1, 'Deletion retry must have one claimant'
    print('PASS concurrent replacements: one winner; report/retirement binds exact revision; deletion race: no late mutation or photo read')
finally:
    # Separate connections require committed fixtures, so one enclosing rollback
    # cannot clean this test. Remove binaries and metadata through Storage instead.
    try:
        if storage_started:
            storage_fixtures('remove')
            path_list = ",".join("'" + path + "'" for path in paths)
            remaining = query(f"select count(*) from storage.objects where bucket_id='profile-photos' "
                              f"and name in ({path_list});").stdout.strip()
            assert remaining == '0', 'Storage fixture metadata remained after API cleanup'
    finally:
        if user_created:
            query(f"delete from auth.users where id='{user}';")
        if reporter_created:
            query(f"delete from auth.users where id='{reporter}';")
        if other_reporter_created:
            query(f"delete from auth.users where id='{other_reporter}';")
