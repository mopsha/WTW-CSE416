"""Photo CAS and deletion races on a disposable migrated PostgreSQL database.

Uses metadata-only Storage fixtures, never real uploaded objects. Actual Storage
authorization and physical deletion require tests/api/avatars.test.mjs.
"""
import argparse
import concurrent.futures
import subprocess
import time
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--dsn', required=True)
args = parser.parse_args()
base = ['psql', args.dsn, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1']
user = str(uuid.uuid4())
paths = [f'{user}/{uuid.uuid4()}.jpg' for _ in range(2)]


def query(sql, check=True):
    result = subprocess.run(base, input=sql, text=True, capture_output=True, timeout=15)
    if check and result.returncode:
        raise AssertionError(result.stderr)
    return result


try:
    query(f"""
      insert into auth.users(id,raw_user_meta_data) values('{user}','{{"display_name":"Photo race"}}');
      insert into storage.objects(bucket_id,name) values
        ('profile-photos','{paths[0]}'),('profile-photos','{paths[1]}');
    """)
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
    # Only metadata fixtures inserted above, with no backing uploaded binaries.
    query(f"delete from storage.objects where bucket_id='profile-photos' and name in ('{paths[0]}','{paths[1]}'); "
          f"delete from auth.users where id='{user}';")
