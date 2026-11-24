"""Optional taste rows held locked by another connection never block core Pick writes (0047 + 0049).
Disposable local migrated database only."""
import argparse
import os
import subprocess
import sys
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

# The queue tests below need real accounts (removed again at the end): a queued row whose
# account is gone is dropped when it commits.
def add_users(ids):
    query("insert into auth.users(id,email,raw_user_meta_data) select id::uuid,'q'||id||'@example.invalid','{\"display_name\":\"Queued\"}'::jsonb from (%s) u(id) on conflict do nothing" % ids)


add_users("select 'ae000000-0000-4000-8000-'||lpad(n::text,12,'0') from generate_series(1,99) n where n<=20 or n=99")
add_users("select 'f1780000-0000-4000-8000-'||lpad(n::text,12,'0') from generate_series(1,999) n where n<=201 or n>=998")

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
def held_lock(statement, end='rollback'):
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
        holder.stdin.write(end + ';\n')
        holder.stdin.close()
        holder.wait(timeout=10)
    assert holder.returncode == 0, holder.stderr.read()


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


# #78 re-review (Mike, Josh): a profile save, photo change or account deletion holds the user's
# profiles row FOR UPDATE. No Pick action may fail or wait on that because of learning, and
# what it taught must still arrive once the row is free.
def act(statement):
    result = subprocess.run(base + ['-c', "set statement_timeout='5s'; " + statement],
                            capture_output=True, text=True, timeout=10)
    assert result.returncode == 0, result.stderr


def source_row(kind, pick, place, who):
    return "user_id='%s' and source=private.taste_source('%s','%s',%s)" % (
        who, kind, pick, "'%s'" % place if place else 'null')


def learned(*row):
    return query('select weight from public.taste_signals where ' + source_row(*row)) or 'none'


def queued_actions(*row):
    return query('select count(*) from private.taste_pending where revision is not null and ' + source_row(*row))


# The guest only: a close also rechecks picks.host_id, so the host's row is core's own wait.
profiles_locked = "select 1 from public.profiles where id='%s' for update" % user(2)
completed = ranking.replace("'final_vote','winnerPlaceId',null", "'completed','winnerPlaceId','taste-a'")


def close(pick, payload):
    return "select public.pick_close_apply('%s','host','%s',(select version::text from public.picks where id='%s'),%s)" % (
        pick, user(1), pick, payload)


def survives_profile_lock(kind, pick, place, action, saved, weight):
    row = (kind, pick, place, user(2))
    with held_lock(profiles_locked):
        act(action)
        assert query(saved) == 't', 'the action did not save'
        assert (learned(*row), queued_actions(*row)) == ('none', '1'), (learned(*row), queued_actions(*row))
        query(sweep)  # still locked: stays queued, and the sweep carries on
        assert queued_actions(*row) == '1', 'a locked user was dropped from the queue'
    query(sweep)
    assert (learned(*row), queued_actions(*row)) == (weight, '0'), (learned(*row), queued_actions(*row))


def swipe_survives_profile_lock():
    pick = setup()
    survives_profile_lock(
        'swipe', pick, 'taste-b',
        "select public.heartbeat_upsert_swipe('%s','%s','taste-b',0)" % (pick, user(2)),
        "select value=0 from public.preferences where pick_id='%s' and user_id='%s' and place_id='taste-b'" % (pick, user(2)),
        '-1')


def vote_survives_profile_lock():
    pick = setup()
    query(close(pick, ranking))
    survives_profile_lock(
        'vote', pick, None,
        "select public.pick_cast_vote('%s','%s','taste-b')" % (pick, user(2)),
        "select place_id='taste-b' from public.final_votes where pick_id='%s' and user_id='%s'" % (pick, user(2)),
        '1')


def winning_close_survives_profile_lock():
    pick = setup()
    survives_profile_lock(
        'winner', pick, None, close(pick, completed),
        "select state='completed' and winner_place_id='taste-a' from public.picks where id='%s'" % pick,
        '2')


def vote_settlement_survives_profile_lock():
    pick = setup()
    query(close(pick, ranking))
    survives_profile_lock(
        'winner', pick, None,
        "select public.pick_close_vote_apply('%s','taste-b','vote')" % pick,
        "select state='completed' and winner_place_id='taste-b' from public.picks where id='%s'" % pick,
        '2')


def forget_state(pick):
    # A swipe from before 0056 has a signal but no source state, so cleanup inserts a new row.
    query('delete from private.taste_source_state where ' + source_row('swipe', pick, 'taste-a', user(2)))


def refresh_survives(lock):
    pick = setup()
    forget_state(pick)
    row = ('swipe', pick, 'taste-a', user(2))
    with held_lock(lock.replace('{p}', pick)):
        act("select public.pick_refresh('%s','%s','%s')" % (pick, user(1), deck))
        assert query("select count(*) from public.preferences where pick_id='%s'" % pick) == '0'
        assert queued_actions(*row) == '1', 'the cleanup was not queued'
    query(sweep)
    assert (learned(*row), queued_actions(*row)) == ('none', '0'), (learned(*row), queued_actions(*row))


def refresh_survives_profile_lock():
    refresh_survives(profiles_locked)


def refresh_survives_a_busy_refresh_lock():
    refresh_survives("select pg_advisory_xact_lock_shared(private.taste_refresh_lock_key(private.taste_source('swipe','{p}','taste-a')))")


def swipe_after_a_queued_refresh_wins():
    # Same deck again, so the same source: the queued cleanup must not erase the new answer.
    pick = setup()
    forget_state(pick)
    row = ('swipe', pick, 'taste-a', user(2))
    with held_lock(profiles_locked):
        act("select public.pick_refresh('%s','%s','%s')" % (pick, user(1), deck))
    query("select public.heartbeat_upsert_swipe('%s','%s','taste-a',0)" % (pick, user(2)))
    query(sweep)
    assert (learned(*row), queued_actions(*row)) == ('-1', '0'), (learned(*row), queued_actions(*row))


def newest_queued_action_wins_across_batches():
    pick = setup()
    row = ('swipe', pick, 'taste-b', user(2))
    with held_lock("select private.lock_taste('%s')" % user(2)):
        query("select public.heartbeat_upsert_swipe('%s','%s','taste-b',2)" % (pick, user(2)))
        query("insert into private.taste_pending(user_id) select 'f1780000-0000-4000-8000-000000000998' from generate_series(1,200)")
        query("select public.heartbeat_upsert_swipe('%s','%s','taste-b',0)" % (pick, user(2)))
    assert queued_actions(*row) == '2'
    query("delete from public.picks where id='%s'" % pick)
    query(sweep)
    assert (learned(*row), queued_actions(*row)) == ('-1', '1'), 'an older queued answer showed between sweeps'
    query(sweep)
    assert (learned(*row), queued_actions(*row)) == ('-1', '0')


# #78 re-review (Josh): deleting an account removes what's queued for it, however the deletion
# and an enqueue overlap.
victim = user(3)
forget = "delete from auth.users where id='%s'" % victim
enqueue = "select private.capture_taste('%s',array['f1780000-0000-4000-8000-00000000000a'::uuid],clock_timestamp(),'cafe',1,false,false)" % victim
busy_taste = "select private.lock_taste('%s')" % victim


def victim_rows(table='taste_pending'):
    return query("select count(*) from private.%s where user_id='%s'" % (table, victim))


def add_victim():
    add_users("select '%s'" % victim)
    assert victim_rows() == '0'


def in_background(statement, waiting="wait_event_type='Lock'"):
    """Starts a statement and returns once it's blocked on a lock."""
    name = 'taste-race-%s' % time.monotonic_ns()
    run = subprocess.Popen(base + ['-c', "set application_name='%s'; set statement_timeout='10s'; %s" % (name, statement)],
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    deadline = time.monotonic() + 5
    while query("select count(*) from pg_stat_activity where application_name='%s' and %s" % (name, waiting)) != '1':
        assert run.poll() is None and time.monotonic() < deadline, 'did not wait: ' + (run.communicate(timeout=15)[1] or '')
        time.sleep(0.02)
    return run


def finished(run):
    _, stderr = run.communicate(timeout=15)
    assert run.returncode == 0, stderr


def deletion_drops_a_committed_enqueue():
    add_victim()
    with held_lock(busy_taste):
        query(enqueue)
    assert victim_rows() == '1'
    query(forget)
    assert victim_rows() == '0', 'a queued action outlived its account'


def deletion_during_an_open_swipe():
    # The real path: the swipe queues, and the deletion waits for its transaction.
    add_victim()
    pick = setup()
    query("insert into pick_participants(pick_id,user_id) values('%s','%s')" % (pick, victim))
    query("select public.heartbeat_upsert_swipe('%s','%s','taste-a',2)" % (pick, victim))
    with held_lock(busy_taste):
        with held_lock("select public.heartbeat_upsert_swipe('%s','%s','taste-a',0)" % (pick, victim), 'commit'):
            gone = in_background(forget)
    finished(gone)
    assert victim_rows() == '0', 'a swipe queued during the deletion outlived the account'


def enqueue_commits_after_the_deletion():
    add_victim()
    with held_lock(busy_taste):
        with held_lock(enqueue, 'commit'):
            query(forget)
    assert victim_rows() == '0', 'an enqueue that committed after the deletion was kept'


def enqueue_commits_inside_the_deletion():
    add_victim()
    with held_lock(forget, 'commit'):
        act(enqueue)
        assert victim_rows() == '1'
    assert victim_rows() == '0', 'an enqueue that committed inside the deletion was kept'


def enqueue_survives_a_deletion_that_rolls_back():
    add_victim()
    with held_lock(forget):
        act(enqueue)
    query(sweep)
    assert (victim_rows(), victim_rows('taste_source_state')) == ('0', '1')
    query(forget)
    assert victim_rows('taste_source_state') == '0'


# "set constraints all immediate" runs the commit-time step early and keeps the transaction
# open, which is the moment between one side's check and its commit.
def deletion_waits_for_a_committing_enqueue():
    add_victim()
    with held_lock(busy_taste):
        with held_lock(enqueue + '; set constraints all immediate', 'commit'):
            gone = in_background(forget, "wait_event='advisory'")
    finished(gone)
    assert victim_rows() == '0'


def enqueue_waits_for_a_committing_deletion():
    add_victim()
    with held_lock(forget + '; set constraints all immediate', 'commit'):
        late = in_background(enqueue, "wait_event='advisory'")
    finished(late)
    assert victim_rows() == '0'


def unrelated_swipe_and_vote_commit_during_deletion():
    add_victim()
    swipe_pick = setup()
    vote_pick = setup()
    query(close(vote_pick, ranking))
    guest = user(2)
    swipe_row = ('swipe', swipe_pick, 'taste-a', guest)
    vote_row = ('vote', vote_pick, None, guest)

    # Hold the deletion's commit lock while an independent lock forces both actions to queue.
    # Each RPC must commit before either holder is released.
    with held_lock(forget + '; set constraints all immediate', 'commit'):
        with held_lock("select private.lock_taste('%s')" % guest):
            act("set lock_timeout='2s'; select public.heartbeat_upsert_swipe('%s','%s','taste-a',0)" % (swipe_pick, guest))
            act("set lock_timeout='2s'; select public.pick_cast_vote('%s','%s','taste-b')" % (vote_pick, guest))
            assert query("select value from public.preferences where pick_id='%s' and user_id='%s' and place_id='taste-a'" % (swipe_pick, guest)) == '0'
            assert query("select place_id from public.final_votes where pick_id='%s' and user_id='%s'" % (vote_pick, guest)) == 'taste-b'
            assert (queued_actions(*swipe_row), queued_actions(*vote_row)) == ('1', '1')

    query(sweep)
    assert (learned(*swipe_row), queued_actions(*swipe_row)) == ('-1', '0')
    assert (learned(*vote_row), queued_actions(*vote_row)) == ('1', '0')


# A sweep that claims a row and then rolls back must not bring it back after the deletion.
def deletion_waits_for_an_open_sweep():
    add_victim()
    query("insert into private.taste_pending(user_id) values ('%s')" % victim)
    with held_lock(sweep):
        gone = in_background(forget)
    finished(gone)
    assert victim_rows() == '0', 'a sweep that rolled back kept a deleted account queued'


def sweep_leaves_an_account_being_deleted():
    add_victim()
    query("insert into private.taste_pending(user_id) values ('%s')" % victim)
    with held_lock(forget, 'commit'):
        query(sweep)
        assert victim_rows() == '1', 'the sweep claimed work for an account being deleted'
    assert victim_rows() == '0'


def sweep_drops_a_leftover_of_a_deleted_account():
    # Backstop: a row that got past the trigger.
    gone = 'f1780000-0000-4000-8000-000000000997'
    query("begin; alter table private.taste_pending disable trigger user; insert into private.taste_pending(user_id,source,revision,action_at,place_type,weight,google) values ('%s',gen_random_uuid(),gen_random_uuid(),now(),'cafe',1,false); alter table private.taste_pending enable trigger user; commit" % gone)
    assert query("select count(*) from private.taste_pending where user_id='%s'" % gone) == '1'
    query(sweep)
    assert query("select (select count(*) from private.taste_pending where user_id='%s')+(select count(*) from private.taste_source_state where user_id='%s')" % (gone, gone)) == '0'


failures = []
checks = [bounded_sweep_reaches_unlocked_user, overlapping_sweeps_preserve_history,
          failed_rebuild_retains_claimed_entries, swipe_survives_profile_lock,
          vote_survives_profile_lock, winning_close_survives_profile_lock,
          vote_settlement_survives_profile_lock, refresh_survives_profile_lock,
          refresh_survives_a_busy_refresh_lock, swipe_after_a_queued_refresh_wins,
          newest_queued_action_wins_across_batches, deletion_drops_a_committed_enqueue,
          deletion_during_an_open_swipe, enqueue_commits_after_the_deletion,
          enqueue_commits_inside_the_deletion, enqueue_survives_a_deletion_that_rolls_back,
          deletion_waits_for_a_committing_enqueue, enqueue_waits_for_a_committing_deletion,
          unrelated_swipe_and_vote_commit_during_deletion,
          deletion_waits_for_an_open_sweep, sweep_leaves_an_account_being_deleted,
          sweep_drops_a_leftover_of_a_deleted_account]
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
query("delete from auth.users where id='%s' or id::text like 'ae000000-0000-4000-8000-%%' or id::text like 'f1780000-0000-4000-8000-%%'" % victim)
# The other 0056 races run here too, so CI's one taste step covers all three scripts.
for script in ('taste_source_concurrency.py', 'google_taste_concurrency.py'):
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), script)
    sys.stdout.flush()
    if subprocess.run([sys.executable, path, '--dsn', args.dsn]).returncode:
        failures.append(script)
if failures:
    raise SystemExit('failed: ' + ', '.join(failures))
