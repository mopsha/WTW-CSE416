"""Optional taste rows held locked by another connection never block core Pick writes (0047 + 0049).
Disposable local migrated database only."""
import argparse
import subprocess
import time
from contextlib import contextmanager
from urllib.parse import urlparse

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--dsn', required=True)
args = parser.parse_args()
if not ('host=/tmp/' in args.dsn or urlparse(args.dsn).hostname in ('localhost', '127.0.0.1', '::1')):
    parser.error('Use a disposable local database only.')
base = ['psql', '-X', '-qAt', args.dsn, '-v', 'ON_ERROR_STOP=1']

def query(statement):
    result = subprocess.run(base + ['-c', statement], capture_output=True, text=True, timeout=15)
    if result.returncode:
        raise AssertionError(result.stderr)
    return result.stdout.strip()

def user(n):
    return 'ad000000-0000-4000-8000-' + str(n).zfill(12)

query("insert into auth.users(id,email,raw_user_meta_data) select ('ad000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'taste'||n||'@example.invalid',jsonb_build_object('display_name','Taste '||n) from generate_series(1,2)n on conflict do nothing")
deck = '[{"placeId":"taste-a","snapshot":{"name":"A","lat":40,"lng":-73,"tasteType":"cafe"},"tasteScore":0.5},{"placeId":"taste-b","snapshot":{"name":"B","lat":40,"lng":-73,"tasteType":"museum"},"tasteScore":-0.5}]'
ranking = "jsonb_build_object('state','final_vote','winnerPlaceId',null,'voteDeadlineAt',now()+interval '30 minutes','rows','[{\"place_id\":\"taste-a\",\"rank\":1,\"score\":80,\"finalist\":true},{\"place_id\":\"taste-b\",\"rank\":2,\"score\":70,\"finalist\":true}]'::jsonb)"

def setup():
    pick = query("select public.pick_create('%s','food',40,-73,3000,10,null,100)->>'id'" % user(1))
    query("insert into pick_participants(pick_id,user_id) values('%s','%s')" % (pick, user(2)))
    query("select public.pick_start('%s','%s','%s')" % (pick, user(1), deck))
    query("select public.heartbeat_upsert_swipe('%s','%s','taste-a',2)" % (pick, user(2)))
    assert query("select count(*) from private.pick_candidate_taste where pick_id='%s'" % pick) == '2'
    assert query("select count(*) from public.taste_signals where user_id='%s'" % user(2)) != '0'
    return pick

cases = {
    'close vs locked group scores': (
        "select 1 from private.pick_candidate_taste where pick_id='{p}' for update",
        "select public.pick_close_apply('{p}','host','%s',(select version::text from public.picks where id='{p}'),%s)" % (user(1), ranking)),
    'refresh vs locked group scores': (
        "select 1 from private.pick_candidate_taste where pick_id='{p}' for update",
        "select public.pick_refresh('{p}','%s','%s')" % (user(1), deck)),
    'changed swipe vs locked signal': (
        "select 1 from public.taste_signals where user_id='%s' for update" % user(2),
        "select public.heartbeat_upsert_swipe('{p}','%s','taste-a',0)" % user(2)),
    'close vs table-locked group scores': (
        'lock table private.pick_candidate_taste in share mode',
        "select public.pick_close_apply('{p}','host','%s',(select version::text from public.picks where id='{p}'),%s)" % (user(1), ranking)),
    'refresh vs table-locked group scores': (
        'lock table private.pick_candidate_taste in share mode',
        "select public.pick_refresh('{p}','%s','%s')" % (user(1), deck)),
    'replacement refresh vs locked group scores': (
        "select 1 from private.pick_candidate_taste where pick_id='{p}' for update",
        "select public.pick_refresh('{p}','%s','%s')" % (user(1), '[{"placeId":"taste-new","snapshot":{"name":"New","lat":40,"lng":-73,"tasteType":"cafe"},"tasteScore":0.4}]')),
    'refresh vs locked signal': (
        "select 1 from public.taste_signals where user_id='%s' for update" % user(2),
        "select public.pick_refresh('{p}','%s','%s')" % (user(1), deck)),
    'purge vs table-locked group scores': (
        'lock table private.pick_candidate_taste in share mode',
        "select public.purge_google_coordinates(now()-interval '30 days')"),
    'delete Pick vs locked group scores': (
        "select 1 from private.pick_candidate_taste where pick_id='{p}' for update",
        "delete from public.picks where id='{p}'"),
    'account deletion vs locked group scores': (
        "select 1 from private.pick_candidate_taste where pick_id='{p}' for update",
        "delete from auth.users where id='%s'" % user(1)),
}
for name, (lock, write) in cases.items():
    pick = setup()
    holder = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    try:
        holder.stdin.write("set statement_timeout='20s'; begin;\n" + lock.replace('{p}', pick) + ";\n\\echo LOCKED\n")
        holder.stdin.flush()
        while True:
            line = holder.stdout.readline()
            if not line:
                raise AssertionError(holder.stderr.read())
            if 'LOCKED' in line:
                break
        # The core write must finish while the optional rows are still locked.
        result = subprocess.run(base + ['-c', "set statement_timeout='5s'; " + write.replace('{p}', pick)], capture_output=True, text=True, timeout=10)
        if result.returncode:
            raise AssertionError('%s: %s' % (name, result.stderr))
        if name.startswith('close'):
            assert query("select state from public.picks where id='%s'" % pick) == 'final_vote', name
        if name.startswith('close'):
            assert query("select count(*) from public.ranking_results where pick_id='%s'" % pick) == '2', name
            assert query("select winner_place_id is null from public.picks where id='%s'" % pick) == 't', name
        if 'refresh' in name:
            assert query("select state from public.picks where id='%s'" % pick) == 'swiping', name
            assert query("select count(*) from public.preferences where pick_id='%s'" % pick) == '0', name
        if name == 'changed swipe vs locked signal':
            assert query("select value from public.preferences where pick_id='%s' and user_id='%s' and place_id='taste-a'" % (pick, user(2))) == '0', name
    finally:
        if holder.poll() is None:
            holder.stdin.write('rollback;\n\\q\n')
            holder.stdin.flush()
            holder.wait(timeout=10)
    print('ok -', name)

    if name == 'replacement refresh vs locked group scores':
        assert query("select count(*) from private.pick_candidate_taste where pick_id='%s'" % pick) == '3'
        query("select public.purge_google_coordinates(now()-interval '30 days')")
        assert query("select count(*) from private.pick_candidate_taste where pick_id='%s'" % pick) == '1'
        assert query("select taste_score from private.pick_candidate_taste where pick_id='%s' and place_id='taste-new'" % pick) == '0.4'
        query("select public.purge_google_coordinates(now()-interval '30 days')")
        assert query("select count(*) from private.pick_candidate_taste where pick_id='%s'" % pick) == '1'
        query("select public.heartbeat_upsert_swipe('%s','%s','taste-new',2)" % (pick,user(2)))
        assert query("select deadline_at is null from public.picks where id='%s'" % pick) == 't'
        print('ok - active No-deadline orphan purge preserves current scores and usability')

    if name == 'delete Pick vs locked group scores':
        assert query("select count(*) from public.picks where id='%s'" % pick) == '0'
        query("select public.purge_google_coordinates(now()-interval '30 days')")
        assert query("select count(*) from private.pick_candidate_taste where pick_id='%s'" % pick) == '0'
        print('ok - deleted Pick cache is eventually purged')
    if name == 'account deletion vs locked group scores':
        assert query("select host_id is null and state='canceled' from public.picks where id='%s'" % pick) == 't'
        query("select public.purge_google_coordinates(now()-interval '30 days')")
        assert query("select count(*) from private.pick_candidate_taste where pick_id='%s'" % pick) == '0'
        print('ok - account deletion preserves guest history and deferred cache cleanup')

# #78 (Josh): while another Pick holds this user's taste lock (a closing Pick's winner trigger
# holds every participant's until it commits), a Yes -> No change elsewhere skips its learning
# write. It must not leave the old Yes behind: the sweep rebuilds from the saved swipe.
# (The case above deleted user 1, so bring both users back first.)
query("insert into auth.users(id,email,raw_user_meta_data) select ('ad000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'taste'||n||'@example.invalid',jsonb_build_object('display_name','Taste '||n) from generate_series(1,2)n on conflict do nothing")
pick = setup()
other = query("select public.pick_create('%s','food',40,-73,3000,10,null,100)->>'id'" % user(1))
query("insert into pick_participants(pick_id,user_id) values('%s','%s')" % (other, user(2)))
query("select public.pick_start('%s','%s','%s')" % (other, user(1), deck))
signal = "select coalesce((select weight::text from public.taste_signals where user_id='%s' and source=private.taste_source('swipe','%s','taste-a')),'none')" % (user(2), pick)
assert query(signal) == '1', query(signal)
holder = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
try:
    holder.stdin.write("set statement_timeout='20s'; begin;\nselect public.heartbeat_upsert_swipe('%s','%s','taste-b',2);\n\\echo LOCKED\n" % (other, user(2)))
    holder.stdin.flush()
    while 'LOCKED' not in holder.stdout.readline():
        if holder.poll() is not None:
            raise AssertionError(holder.stderr.read())
    result = subprocess.run(base + ['-c', "set statement_timeout='5s'; select public.heartbeat_upsert_swipe('%s','%s','taste-a',0)" % (pick, user(2))], capture_output=True, text=True, timeout=10)
    if result.returncode:
        raise AssertionError('changed swipe vs held taste lock: %s' % result.stderr)
finally:
    holder.stdin.write('commit;\n\\q\n')
    holder.stdin.flush()
    holder.wait(timeout=10)
assert query("select value from public.preferences where pick_id='%s' and user_id='%s' and place_id='taste-a'" % (pick, user(2))) == '0'
query("select public.purge_google_taste(now()-interval '30 days')")  # the sweep
got = query(signal)
assert got == '-1', 'a No skipped behind a held taste lock must not keep the old Yes after the sweep, got %r' % got
print('ok - changed swipe skipped behind another Pick converges to the saved No on the next sweep')

# #78 re-review (Josh), point 4: the sweep never waits on a user whose taste lock is busy
# (200 locked users used to cost 200ms each). Busy users stay queued; everyone else drains.
busy = ['ae000000-0000-4000-8000-%012d' % n for n in range(1, 21)]
free = 'ae000000-0000-4000-8000-000000000099'
users = "array[%s]::uuid[]" % ','.join("'%s'" % u for u in busy)
query("insert into private.taste_pending (user_id) select unnest(%s) union all select '%s'::uuid" % (users, free))
holder = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
try:
    holder.stdin.write("set statement_timeout='30s'; begin;\nselect count(pg_advisory_xact_lock(hashtextextended('wtw-taste:' || u::text, 0))) from unnest(%s) u;\n\\echo LOCKED\n" % users)
    holder.stdin.flush()
    while 'LOCKED' not in holder.stdout.readline():
        if holder.poll() is not None:
            raise AssertionError(holder.stderr.read())
    started = time.time()
    query("select public.purge_google_taste(now()-interval '30 days')")
    took = time.time() - started
    assert took < 1.5, 'the sweep waited on locked users: %.1fs for 20' % took
    left = query("select count(*) from private.taste_pending where user_id = any(%s)" % users)
    assert left == '20', 'busy users must stay queued, got %s' % left
    assert query("select count(*) from private.taste_pending where user_id='%s'" % free) == '0'
finally:
    holder.stdin.write('rollback;\n\\q\n')
    holder.stdin.flush()
    holder.wait(timeout=10)
query("select public.purge_google_taste(now()-interval '30 days')")
assert query("select count(*) from private.taste_pending where user_id = any(%s)" % users) == '0'
print('ok - the sweep skips users whose taste lock is busy and processes them next time')


sweep = "select public.purge_google_taste(now()-interval '30 days')"


@contextmanager
def held_lock(statement):
    holder = subprocess.Popen(
        base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    try:
        holder.stdin.write("begin;\n" + statement + ";\n\\echo LOCKED\n")
        holder.stdin.flush()
        for line in holder.stdout:
            if line.strip() == 'LOCKED':
                break
        else:
            raise AssertionError(holder.stderr.read())
        yield
    finally:
        holder.stdin.close()
        holder.wait(timeout=10)


def bounded_sweep_reaches_unlocked_user():
    pending = 'f1780000-0000-4000-8000-'
    queued = "('%s' || lpad(n::text, 12, '0'))::uuid" % pending
    query("insert into private.taste_pending(user_id) select %s from generate_series(1,201) n" % queued)
    with held_lock("select private.lock_taste(%s) from generate_series(1,200) n" % queued):
        for _ in range(2):
            query(sweep)
        assert query("select count(*) from private.taste_pending where user_id='%s000000000201'" % pending) == '0', (
            'unlocked user was still queued after sweeping past 200 busy users'
        )
        assert query("select count(*) from private.taste_pending where user_id::text like '%s%%'" % pending) == '200'
    for _ in range(2):
        query(sweep)
    assert query("select count(*) from private.taste_pending where user_id::text like '%s%%'" % pending) == '0'


def overlapping_sweeps_preserve_history():
    pick = setup()
    guest = user(2)
    source = "private.taste_source('swipe','%s','taste-a')" % pick
    signal = "select weight from public.taste_signals where user_id='%s' and source=%s" % (guest, source)
    queued = "select count(*) from private.taste_pending where user_id='%s' and source=%s" % (guest, source)
    # Put a distinct user ahead of the repair in the batch.
    query("insert into private.taste_pending(user_id) values ('f1780000-0000-4000-8000-000000000999')")
    with held_lock("select private.lock_taste('%s')" % guest):
        query("select public.heartbeat_upsert_swipe('%s','%s','taste-a',0)" % (pick, guest))
    query("insert into private.taste_pending(user_id,source) values ('%s',%s)" % (guest, source))
    assert query(signal) == '1' and query(queued) == '2'

    query("""
        create function private.test_taste_pause_sweep() returns trigger
        language plpgsql set lock_timeout = '0' as $$
        begin
          if current_setting('application_name') = 'taste-overlap-test' then
            perform pg_advisory_xact_lock(781056);
          end if;
          return null;
        end $$;
        create trigger test_taste_pause_sweep after insert on public.taste_signals
          for each statement execute function private.test_taste_pause_sweep()
    """)
    first = None
    try:
        with held_lock("select pg_advisory_xact_lock(781056)"):
            first = subprocess.Popen(
                base + ['-c', "set application_name='taste-overlap-test'; " + sweep],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            )
            deadline = time.monotonic() + 10
            while query("""select count(*) from pg_stat_activity
                where application_name='taste-overlap-test' and wait_event='advisory'""") != '1':
                assert first.poll() is None and time.monotonic() < deadline, 'sweep did not reach the barrier'
                time.sleep(0.02)
            query(sweep)
            if query(queued) == '0':
                # If sweep B drained the same IDs, delete the Pick before A can use its snapshot.
                assert query(signal) == '-1'
                query("delete from public.picks where id='%s'" % pick)
        _, stderr = first.communicate(timeout=15)
        assert first.returncode == 0, stderr
        assert query(queued) == '0'
        query("delete from public.picks where id='%s'" % pick)
        assert query(signal) == '-1', 'overlapping sweeps erased the repaired historical No'
    finally:
        if first is not None and first.poll() is None:
            first.kill()
            first.communicate()
        query("""drop trigger test_taste_pause_sweep on public.taste_signals;
                 drop function private.test_taste_pause_sweep()""")


def failed_rebuild_retains_claimed_entries():
    pick = setup()
    guest = user(2)
    source = "private.taste_source('swipe','%s','taste-a')" % pick
    row = "from public.taste_signals where user_id='%s' and source=%s" % (guest, source)
    pending = "select count(*) from private.taste_pending where user_id='%s' and source=%s" % (guest, source)
    with held_lock("select private.lock_taste('%s')" % guest):
        query("select public.heartbeat_upsert_swipe('%s','%s','taste-a',0)" % (pick, guest))
    with held_lock("select 1 " + row + " for update"):
        query(sweep)
        assert query(pending) == '1', 'a rebuild failure discarded the claimed entry'
    query(sweep)
    assert query(pending) == '0'
    assert query("select weight " + row) == '-1'


def split_duplicates_preserve_history():
    pick = setup()
    guest = user(2)
    source = "private.taste_source('swipe','%s','taste-a')" % pick
    with held_lock("select private.lock_taste('%s')" % guest):
        query("select public.heartbeat_upsert_swipe('%s','%s','taste-a',0)" % (pick, guest))
    query("""insert into private.taste_pending(user_id,source)
        select '%s', %s from public.preferences, generate_series(1,200)
        where pick_id='%s' and user_id='%s' and place_id='taste-a'""" % (guest, source, pick, guest))
    query(sweep)
    assert query("select count(*) from private.taste_pending where user_id='%s' and source=%s" % (guest, source)) == '1'
    query("delete from public.picks where id='%s'" % pick)
    query(sweep)
    assert query("select weight from public.taste_signals where user_id='%s' and source=%s" % (guest, source)) == '-1'


failures = []
checks = [bounded_sweep_reaches_unlocked_user, overlapping_sweeps_preserve_history,
          failed_rebuild_retains_claimed_entries]
if query("select to_regclass('private.taste_sweep_cursor') is not null") == 't':
    checks.append(split_duplicates_preserve_history)
for check in checks:
    try:
        check()
        print('ok -', check.__name__)
    except AssertionError as error:
        failures.append(check.__name__)
        print('FAIL -', check.__name__, error)
        # Leave other cases independent on the pre-fix schema, too.
        query(sweep)
        query(sweep)
if failures:
    raise SystemExit('failed: ' + ', '.join(failures))
