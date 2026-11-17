"""Optional taste rows held locked by another connection never block core Pick writes (0047).
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
    'refresh vs locked signal': (
        "select 1 from public.taste_signals where user_id='%s' for update" % user(2),
        "select public.pick_refresh('{p}','%s','%s')" % (user(1), deck)),
}
for name, (lock, write) in cases.items():
    pick = setup()
    holder = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    try:
        holder.stdin.write("set statement_timeout='20s'; begin;\n" + lock.format(p=pick) + ";\n\\echo LOCKED\n")
        holder.stdin.flush()
        while True:
            line = holder.stdout.readline()
            if not line:
                raise AssertionError(holder.stderr.read())
            if 'LOCKED' in line:
                break
        # The core write must finish while the optional rows are still locked.
        result = subprocess.run(base + ['-c', "set statement_timeout='5s'; " + write.format(p=pick)], capture_output=True, text=True, timeout=10)
        if result.returncode:
            raise AssertionError('%s: %s' % (name, result.stderr))
        if name.startswith('close'):
            assert query("select state from public.picks where id='%s'" % pick) == 'final_vote', name
        if name == 'changed swipe vs locked signal':
            assert query("select value from public.preferences where pick_id='%s' and user_id='%s' and place_id='taste-a'" % (pick, user(2))) == '0', name
    finally:
        if holder.poll() is None:
            holder.stdin.write('rollback;\n\\q\n')
            holder.stdin.flush()
            holder.wait(timeout=10)
    print('ok -', name)
