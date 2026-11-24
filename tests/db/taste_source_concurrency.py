"""Regression tests for 0056. Run against a disposable local migrated database."""
import argparse
from contextlib import contextmanager
import subprocess
import time
from urllib.parse import urlparse

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--dsn', required=True)
args = parser.parse_args()
if urlparse(args.dsn).hostname not in ('localhost', '127.0.0.1', '::1'):
    parser.error('Use a disposable local database only.')
psql = ['psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', args.dsn]
host = 'b0780000-0000-4000-8000-000000000001'
guest = 'b0780000-0000-4000-8000-000000000002'
sweep = "select public.purge_google_taste(now()-interval '30 days')"


def query(sql):
    result = subprocess.run(psql + ['-c', sql], text=True, capture_output=True, timeout=10)
    assert result.returncode == 0, result.stderr
    return result.stdout.strip(), result.stderr


@contextmanager
def session():
    with subprocess.Popen(psql, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, text=True) as proc:
        def send(sql):
            proc.stdin.write(sql + ';\n\\echo READY\n')
            proc.stdin.flush()

        def ready():
            for line in proc.stdout:
                if line.strip() == 'READY':
                    return
            raise AssertionError(proc.stderr.read())

        try:
            yield send, ready
        finally:
            proc.stdin.close()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
                raise


def setup():
    pick, _ = query(f"select public.pick_create('{host}','food',40,-73,3000,10,null,100)->>'id'")
    query(f"insert into public.pick_participants(pick_id,user_id) values('{pick}','{guest}')")
    query(f"""select public.pick_start('{pick}','{host}',
          '[{{"placeId":"source-a","snapshot":{{"name":"A","lat":40,"lng":-73,"tasteType":"cafe"}}}}]')""")
    return pick


def swipe(pick, value):
    return f"select public.heartbeat_upsert_swipe('{pick}','{guest}','source-a',{value})"


def source(pick):
    return f"private.taste_source('swipe','{pick}','source-a')"


def weight(pick):
    return query(f"select weight from public.taste_signals where user_id='{guest}' and source={source(pick)}")[0]


def pending(pick):
    return query(f"select count(*) from private.taste_pending where user_id='{guest}' and source={source(pick)}")[0]


def delete_pick(pick):
    query(f"delete from public.picks where id='{pick}'")


def refresh(pick):
    return f"""select public.pick_refresh('{pick}','{host}',
      '[{{"placeId":"source-b","snapshot":{{"name":"B","lat":40,"lng":-73,"tasteType":"bakery"}}}}]')"""


def queue_swipe(pick, value):
    with session() as (hold, ready):
        hold(f"begin; select private.lock_taste('{guest}')")
        ready()
        query(swipe(pick, value))
    assert pending(pick) == '1'


def commit_order(older_action_is_queued):
    pick = setup()
    query(swipe(pick, 1))
    with session() as (older, ready):
        # Fix transaction time before the other writer starts, without locking the Pick.
        older("begin; select now()")
        ready()
        if older_action_is_queued:
            query(swipe(pick, 2))
            with session() as (hold, locked):
                hold(f"begin; select private.lock_taste('{guest}')")
                locked()
                older(swipe(pick, 0) + '; commit')
                ready()
            expected = '-1'
        else:
            queue_swipe(pick, 0)
            older(swipe(pick, 2) + '; commit')
            ready()
            expected = '1'
    assert pending(pick) == '1'
    delete_pick(pick)
    query(sweep)
    assert (weight(pick), pending(pick)) == (expected, '0'), (weight(pick), pending(pick))


def duplicates_across_pages():
    pick = setup()
    query(swipe(pick, 2))
    queue_swipe(pick, 0)
    query(f"""insert into private.taste_pending(user_id,source)
              select '{guest}', {source(pick)} from generate_series(1,200)""")
    query(sweep)
    assert (weight(pick), pending(pick)) == ('-1', '1')
    delete_pick(pick)
    query(sweep)
    assert (weight(pick), pending(pick)) == ('-1', '0')


def refresh_during_contention():
    pick = setup()
    unrelated = setup()
    query(swipe(pick, 2))
    query(swipe(unrelated, 2))
    with session() as (hold, locked):
        hold(f"begin; select private.lock_taste('{guest}')")
        locked()
        query(swipe(pick, 0))
        assert pending(pick) == '1'
        query(refresh(pick))
        assert query(f"select count(*) from public.preferences where pick_id='{pick}'")[0] == '0'
        assert weight(pick) == ''
    query(sweep)
    assert (weight(pick), pending(pick), weight(unrelated)) == ('', '0', '1'), (
        weight(pick), pending(pick), weight(unrelated))


def sweep_during_refresh():
    pick = setup()
    queue_swipe(pick, 0)
    with session() as (writer, ready):
        writer('begin; ' + refresh(pick))
        ready()
        query(sweep)
        assert (weight(pick), pending(pick)) == ('', '1'), (weight(pick), pending(pick))
        writer('commit')
        ready()
    query(sweep)
    assert (weight(pick), pending(pick)) == ('', '0'), (weight(pick), pending(pick))


def commit_order_across_reset(pre_reset_action_commits_last):
    pick = setup()
    with session() as (older, ready):
        older("begin; select now()")
        ready()
        query(f"select public.taste_reset('{guest}')")
        if pre_reset_action_commits_last:
            query(swipe(pick, 2))
        with session() as (hold, locked):
            hold(f"begin; select private.lock_taste('{guest}')")
            locked()
            older(swipe(pick, 0) + '; commit')
            ready()
        if not pre_reset_action_commits_last:
            query(swipe(pick, 2))
    expected = '' if pre_reset_action_commits_last else '1'
    assert pending(pick) == '1'
    query(sweep)
    assert (weight(pick), pending(pick)) == (expected, '0'), (weight(pick), pending(pick))


def retention_lock():
    pick = setup()
    query(swipe(pick, 2))
    queue_swipe(pick, 0)
    expired = 'b0780000-0000-4000-8000-000000000003'
    query(f"""insert into public.taste_signals(user_id,source,place_type,weight,at,google)
              values('{host}','{expired}','cafe',1,now()-interval '31 days',true)""")
    try:
        with session() as (hold, locked):
            hold(f"begin; select 1 from public.taste_signals where source='{expired}' for update")
            locked()
            _, warning = query("set statement_timeout='2s'; " + sweep)
            assert 'past retention remain' in warning, warning
            assert (weight(pick), pending(pick)) == ('-1', '0')
    finally:
        assert query(sweep)[0] == '1', 'the expired row did not retry after release'


def delete_during_reconciliation():
    pick = setup()
    query(swipe(pick, 2))
    queue_swipe(pick, 0)
    query("""
      create function private.test_taste_delete_gate() returns trigger
      language plpgsql set lock_timeout = '0' as $$
      begin
        if current_setting('application_name') = 'taste-source-delete-test' then
          if current_setting('test_taste.saw_purge', true) = 'yes' then
            perform pg_advisory_xact_lock(780799);
          else
            perform set_config('test_taste.saw_purge', 'yes', true);
          end if;
        end if;
        return null;
      end $$;
      create trigger test_taste_delete_gate before delete on public.taste_signals
        for each statement execute function private.test_taste_delete_gate()
    """)
    try:
        with session() as (worker, finished):
            with session() as (hold, locked):
                hold('begin; select pg_advisory_xact_lock(780799)')
                locked()
                worker("set application_name='taste-source-delete-test'; " + sweep)
                deadline = time.monotonic() + 5
                while query("""select count(*) from pg_stat_activity
                               where application_name='taste-source-delete-test'
                                 and wait_event='advisory'""")[0] != '1':
                    assert time.monotonic() < deadline, 'reconciliation did not reach the barrier'
                # The purge DELETE already ran. The reconciliation DELETE has
                # acquired its snapshot and is stopped before reading any rows.
                delete_pick(pick)
            finished()
        assert (weight(pick), pending(pick)) == ('-1', '0'), (weight(pick), pending(pick))
    finally:
        query("""drop trigger test_taste_delete_gate on public.taste_signals;
                 drop function private.test_taste_delete_gate()""")


query(f"""insert into auth.users(id,email) values
          ('{host}','taste-source-host@example.invalid'),('{guest}','taste-source-guest@example.invalid')""")
failures = []
try:
    for name, check in [
        ('queued No precedes committed Yes', lambda: commit_order(False)),
        ('committed Yes precedes queued No', lambda: commit_order(True)),
        ('duplicate queue entries span pages', duplicates_across_pages),
        ('refresh invalidates a queued swipe under contention', refresh_during_contention),
        ('sweep retries a source while its refresh is uncommitted', sweep_during_refresh),
        ('pre-reset No commits after post-reset Yes', lambda: commit_order_across_reset(True)),
        ('post-reset Yes commits after pre-reset No', lambda: commit_order_across_reset(False)),
        ('locked expiry cannot stall unrelated repair', retention_lock),
        ('Pick deletion during reconciliation', delete_during_reconciliation),
    ]:
        try:
            check()
            print('ok -', name)
        except AssertionError as error:
            failures.append(name)
            print('FAIL -', name, error)
finally:
    query(f"delete from public.picks where host_id='{host}'; delete from auth.users where id in ('{host}','{guest}')")
if failures:
    raise SystemExit('failed: ' + ', '.join(failures))
