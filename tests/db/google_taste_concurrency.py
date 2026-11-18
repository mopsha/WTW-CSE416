"""Races in Google taste learning (0051): reset vs a pending signal, and a changed swipe vs a
stale learning request. Each case holds one transaction open while a second connection runs,
the interleavings that #78's first version got wrong. Disposable local migrated database only.

  python tests/db/google_taste_concurrency.py --dsn postgresql://postgres:postgres@127.0.0.1:54322/postgres
  # without a local psql, run it inside the Supabase DB container:
  python tests/db/google_taste_concurrency.py --psql "docker exec -i supabase_db_WTW-CSE416 psql" \\
      --dsn postgresql://postgres:postgres@localhost:5432/postgres
"""
import argparse
import shlex
import subprocess
import time
from urllib.parse import urlparse

parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
parser.add_argument('--dsn', required=True)
parser.add_argument('--psql', default='psql', help='psql command (e.g. via docker exec)')
args = parser.parse_args()
if urlparse(args.dsn).hostname not in ('localhost', '127.0.0.1', '::1'):
    parser.error('Use a disposable local database only.')
base = shlex.split(args.psql) + ['-X', '-qAt', args.dsn, '-v', 'ON_ERROR_STOP=1']


def query(statement):
    result = subprocess.run(base, input=statement, capture_output=True, text=True, timeout=30)
    if result.returncode:
        raise AssertionError(result.stderr)
    return result.stdout.strip()


def hold(statement, seconds=2):
    """Runs statement in a transaction that stays open (holding its locks) for `seconds`."""
    script = 'begin;\n%s;\nselect pg_sleep(%s);\ncommit;\n' % (statement, seconds)
    proc = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    proc.stdin.write(script)
    proc.stdin.close()
    time.sleep(0.6)  # let it take its locks before the other connection starts
    return proc


def finish(proc):
    if proc.wait(timeout=30):
        raise AssertionError(proc.stderr.read())


def user(n):
    return 'ae000000-0000-4000-8000-' + str(n).zfill(12)


query("insert into auth.users(id,email,raw_user_meta_data) select ('ae000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'gtaste'||n||'@example.invalid',jsonb_build_object('display_name','G '||n) from generate_series(1,2)n on conflict do nothing")
deck = '[{"placeId":"g-a","snapshot":{"placeId":"g-a","name":null,"category":"food","lat":40,"lng":-73,"provider":"google"}}]'
host, guest = user(1), user(2)


def setup():
    query("delete from public.taste_signals where user_id in ('%s','%s')" % (host, guest))
    # The epoch must predate the swipes below (the migration backfills it for existing users).
    # (Skipped on a pre-fix schema without taste_epochs, so the script also shows the old bugs.)
    query("do $$ begin insert into private.taste_epochs(user_id,since) values('%s',now()-interval '1 day'),('%s',now()-interval '1 day') on conflict(user_id) do update set since=excluded.since; exception when undefined_table then null; end $$" % (host, guest))
    pick = query("select public.pick_create('%s','food',40,-73,3000,10,null,100)->>'id'" % host)
    query("insert into pick_participants(pick_id,user_id) values('%s','%s')" % (pick, guest))
    query("select public.pick_start('%s','%s','%s')" % (pick, host, deck))
    return pick


def signals(u):
    return query("select coalesce(string_agg(weight::text, ','), '') from public.taste_signals where user_id='%s'" % u)


def record(pick, kind):
    return "select public.taste_record_google_signal('%s','%s','g-a','%s','sushi_restaurant')" % (guest, pick, kind)


failures = []


def case(name, check):
    try:
        check()
        print('ok   ', name)
    except AssertionError as error:
        failures.append(name)
        print('FAIL ', name, error)


def stale_swipe():
    # A Yes is saved and its learning request is still in flight while the guest changes to No.
    pick = setup()
    query("select public.heartbeat_upsert_swipe('%s','%s','g-a',2)" % (pick, guest))
    change = hold("select public.heartbeat_upsert_swipe('%s','%s','g-a',0)" % (pick, guest))
    query(record(pick, 'swipe'))  # the stale Yes request, racing the uncommitted No
    finish(change)
    got = signals(guest)
    assert got == '', 'the stale Yes request must not leave +1 behind a final No, got %r' % got
    query(record(pick, 'swipe'))  # the No's own request
    got = signals(guest)
    assert got == '-1', 'final No must leave -1, got %r' % got


def record_vs_reset():
    # A winner is being recorded when the user resets: the reset must win.
    pick = setup()
    query("update public.picks set state='completed',winner_place_id='g-a',decided_at=now()-interval '1 hour',decided_by='clear_winner' where id='%s'" % pick)
    pending = hold(record(pick, 'winner'))
    query("select public.taste_reset('%s')" % guest)
    finish(pending)
    got = signals(guest)
    assert got == '', 'reset must clear a concurrently recorded winner, got %r' % got


def reset_vs_record():
    # The reset commits while an older winner's request waits: it must not come back.
    pick = setup()
    query("update public.picks set state='completed',winner_place_id='g-a',decided_at=now()-interval '1 hour',decided_by='clear_winner' where id='%s'" % pick)
    reset = hold("select public.taste_reset('%s')" % guest)
    query(record(pick, 'winner'))
    finish(reset)
    query(record(pick, 'winner'))  # and not on a later read either
    got = signals(guest)
    assert got == '', 'a winner decided before the reset must not return, got %r' % got


def delayed_swipe_after_reset():
    # A swipe made before a reset whose learning request arrives after it.
    pick = setup()
    query("select public.heartbeat_upsert_swipe('%s','%s','g-a',2)" % (pick, guest))
    query("select public.taste_reset('%s')" % guest)
    query(record(pick, 'swipe'))
    got = signals(guest)
    assert got == '', 'a pre-reset swipe must not teach, got %r' % got


case('stale Yes request vs a changed No swipe', stale_swipe)
case('winner being recorded vs reset', record_vs_reset)
case('reset vs a waiting winner request', reset_vs_record)
case('delayed swipe request after reset', delayed_swipe_after_reset)
# Remove the Picks first: deleting a host cancels their Picks, which other tests count.
query("delete from public.picks where host_id in ('%s','%s')" % (host, guest))
query("delete from auth.users where id in ('%s','%s')" % (host, guest))
if failures:
    raise SystemExit('%d failed: %s' % (len(failures), ', '.join(failures)))
print('all passed')
