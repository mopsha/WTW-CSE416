"""Optional taste rows held locked by another connection never block core Pick writes (0047 + 0049).
Disposable local migrated database only."""
import argparse
import subprocess
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
pick = setup()
other = query("select public.pick_create('%s','food',40,-73,3000,10,null,100)->>'id'" % user(1))
query("insert into pick_participants(pick_id,user_id) values('%s','%s')" % (other, user(2)))
query("select public.pick_start('%s','%s','%s')" % (other, user(1), deck))
signal = "select coalesce((select weight::text from public.taste_signals where user_id='%s' and source=private.taste_source('swipe','%s','taste-a')),'none')" % (user(2), pick)
assert query(signal) == '1', query(signal)
holder = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
try:
    holder.stdin.write("set statement_timeout='20s'; begin;\nselect public.heartbeat_upsert_swipe('%s','%s','taste-b',2);\n\echo LOCKED\n" % (other, user(2)))
    holder.stdin.flush()
    while 'LOCKED' not in holder.stdout.readline():
        if holder.poll() is not None:
            raise AssertionError(holder.stderr.read())
    result = subprocess.run(base + ['-c', "set statement_timeout='5s'; select public.heartbeat_upsert_swipe('%s','%s','taste-a',0)" % (pick, user(2))], capture_output=True, text=True, timeout=10)
    if result.returncode:
        raise AssertionError('changed swipe vs held taste lock: %s' % result.stderr)
finally:
    holder.stdin.write('commit;\n\q\n')
    holder.stdin.flush()
    holder.wait(timeout=10)
assert query("select value from public.preferences where pick_id='%s' and user_id='%s' and place_id='taste-a'" % (pick, user(2))) == '0'
query("select public.purge_google_taste(now()-interval '30 days')")  # the sweep
got = query(signal)
assert got == '-1', 'a No skipped behind a held taste lock must not keep the old Yes after the sweep, got %r' % got
print('ok - changed swipe skipped behind another Pick converges to the saved No on the next sweep')
