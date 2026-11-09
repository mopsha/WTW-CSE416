"""Real PostgreSQL concurrency exercise, invoked with an isolated database query callback."""
import concurrent.futures
import uuid


def exercise_username_quota(query):
    viewer, target = str(uuid.uuid4()), str(uuid.uuid4())
    try:
        query(f"insert into auth.users(id,raw_user_meta_data) values('{viewer}','{{}}'),('{target}','{{}}'); update public.profiles set username='quota_{target[:8]}' where id='{target}'; insert into private.username_lookup_events(user_id,created_at) select '{viewer}',now()-interval '2 hours' from generate_series(1,149);")
        def lookup(i):
            sql = (f"select public.person_lookup('{viewer}','{target}');" if i % 2
                   else f"select public.username_search('{viewer}','quota');")
            return query('set role service_role; '+sql, check=False)
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lookup, range(8)))
        assert sum(r.returncode == 0 for r in results) == 1, 'Daily quota must admit exactly one remaining lookup'
        assert all(r.returncode == 0 or 'Discovery limit reached' in r.stderr for r in results), 'Unexpected worker failure'
        print('PASS real SQL concurrent mixed-route quota: one winner at 149/150')
    finally:
        query(f"delete from auth.users where id in ('{viewer}','{target}');")


if __name__ == '__main__':
    import argparse
    import subprocess
    from urllib.parse import urlparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dsn', required=True)
    args = parser.parse_args()
    parsed = urlparse(args.dsn)
    if (parsed.scheme not in ('postgres', 'postgresql') or parsed.hostname not in ('localhost', '127.0.0.1')
            or parsed.port != 54322 or parsed.path != '/postgres' or parsed.query or parsed.fragment):
        parser.error('Expected disposable local Supabase PostgreSQL on port 54322')
    base = ['psql', args.dsn, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1']
    def query(sql, check=True):
        result = subprocess.run(base, input=sql, text=True, capture_output=True, timeout=15)
        if check and result.returncode:
            raise AssertionError('Disposable username concurrency fixture failed')
        return result
    exercise_username_quota(query)
