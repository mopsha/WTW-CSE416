"""Real two-connection regressions; run only against a disposable migrated database.

Usage: python tests/db/pr42_concurrency.py --dsn 'postgresql://.../test_db'
Requires psql. No Python packages or database extensions needed.
"""
import argparse
import concurrent.futures
import subprocess
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--dsn', required=True)
args = parser.parse_args()
base = ['psql', args.dsn, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1']
u = 'a4290001-4242-4242-8242-424242424242'
v = 'a4290002-4242-4242-8242-424242424242'
g = 'a4290000-4242-4242-8242-424242424242'

def query(sql, check=True):
    result = subprocess.run(base, input=sql, text=True, capture_output=True, timeout=15)
    if check and result.returncode:
        raise AssertionError(result.stderr)
    return result


def while_locked(lock_sql, reads):
    app_name = f'pr42_lock_{time.monotonic_ns()}'
    holder = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                              stderr=subprocess.PIPE, text=True)
    try:
        holder.stdin.write(f"set application_name='{app_name}'; begin; " + lock_sql
                           + "; select pg_sleep(10); rollback;\n")
        holder.stdin.close()
        for _ in range(50):
            ready = query("select count(*) from pg_stat_activity where "
                          f"application_name='{app_name}' and wait_event='PgSleep';").stdout.strip()
            if ready == '1':
                break
            if holder.poll() is not None:
                raise AssertionError(holder.stderr.read())
            time.sleep(0.05)
        else:
            raise AssertionError('Lock holder never became ready')
        for read in reads:
            query("set statement_timeout='700ms'; set role service_role; " + read + ';')
    finally:
        query(f"select pg_terminate_backend(pid) from pg_stat_activity where application_name='{app_name}';")
        holder.wait(timeout=5)
        holder.stderr.close()

try:
    query(f"""begin;
    insert into auth.users(id,raw_user_meta_data) values('{u}','{{}}'),('{v}','{{}}');
    insert into public.groups(id,name,owner_id) values('{g}','Concurrency','{u}');
    insert into public.group_members(group_id,user_id,role) values('{g}','{u}','owner'),('{g}','{v}','member');
    insert into public.friendships(requester_id,addressee_id,status,accepted_at) values('{u}','{v}','accepted',now());
    commit;""")
    cid = query(f"select public.direct_chat('open','{u}','{v}')->>'id';").stdout.strip()
    idea = query(f"select public.group_ideas('create','{u}','{g}',null,"
                 "'{\"name\":\"Catan\",\"category\":\"activity\"}')->>'id';").stdout.strip()
    while_locked(f"select 1 from public.groups where id='{g}' for update", [
        f"select public.group_chat('list','{u}','{g}')",
        f"select public.group_ideas('list','{u}','{g}')",
        f"select public.group_ideas('get','{u}','{g}','{idea}')",
    ])
    while_locked(f"select 1 from public.friendships where requester_id='{u}' for update", [
        f"select public.direct_chat('list','{u}','{cid}')",
    ])
    while_locked(f"select 1 from public.direct_conversations where id='{cid}' for update", [
        f"select public.direct_chat('list','{u}','{cid}')",
    ])
    print('PASS: polling does not wait on group/friendship/conversation write locks')

    def send(n):
        action = (f"public.group_chat('send','{u}','{g}'" if n % 2 else
                  f"public.direct_chat('send','{u}','{cid}'")
        return query("set role service_role; select " + action
                     + f",'{{\"body\":\"Concurrent\",\"clientId\":\"pr42-race-{n:04}\"}}');", False)

    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as pool:
        results = list(pool.map(send, range(20)))
    assert sum(r.returncode == 0 for r in results) == 10, [r.stderr for r in results]
    assert all(r.returncode == 0 or 'Too many messages' in r.stderr for r in results)
    assert query(f"select count(*) from public.rate_limit_events where user_id='{u}' and action='message_send';").stdout.strip() == '10'
    first = next(n for n, result in enumerate(results) if result.returncode == 0)
    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as pool:
        retries = list(pool.map(send, [first] * 20))
    assert all(result.returncode == 0 for result in retries), [r.stderr for r in retries]
    assert query(f"select count(*) from public.rate_limit_events where user_id='{u}' and action='message_send';").stdout.strip() == '10'
    print('PASS: concurrent group and DM sends share one atomic ten-message burst budget; capped retries stay idempotent')
finally:
    query(f"delete from public.groups where id='{g}'; delete from auth.users where id in ('{u}','{v}');")
