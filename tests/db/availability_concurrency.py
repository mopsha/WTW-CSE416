"""Deterministic row-lock races on a disposable local database; no remote access."""
import subprocess, time, json, argparse
from urllib.parse import urlparse
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--dsn', required=True)
args = parser.parse_args()
if not ('host=/tmp/' in args.dsn or urlparse(args.dsn).hostname in ('localhost', '127.0.0.1', '::1')):
    parser.error('Use a disposable local database only.')
PSQL = ['psql', '-X', '-qAt', args.dsn, '-v', 'ON_ERROR_STOP=1']

def sql(s):
    r = subprocess.run(PSQL + ['-c', s], capture_output=True, text=True, timeout=15)
    if r.returncode:
        raise RuntimeError(r.stderr)
    return r.stdout.strip()
uid = lambda n: 'ac000000-0000-4000-8000-' + str(n).zfill(12)
sql("insert into auth.users(id,email,raw_user_meta_data) select ('ac000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'race'||n||'@example.invalid',jsonb_build_object('display_name','Race '||n) from generate_series(1,3)n on conflict do nothing")

def setup():
    p = sql("select public.pick_create_options('%s',jsonb_build_object('category','food','center',jsonb_build_object('lat',40,'lng',-73),'radiusM',3000,'poolSize',10,'closeThreshold',100,'deadlineAt',null,'proposedAt',now()+interval '3 days','swipeDeadlineMinutes',60))->>'id'" % uid(1))
    sql("insert into pick_participants(pick_id,user_id) values('%s','%s'); select public.pick_availability_respond('%s','%s',1,'yes')" % (p, uid(2), p, uid(2)))
    return p
results = []
for label in ['duplicate start', 'time vs response', 'start vs response', 'start vs time', 'response vs start', 'cancel vs response', 'revoke vs response']:
    p = setup()
    claim = "select public.pick_availability_claim('%s','%s');" % (p, uid(1))
    respond = "select public.pick_availability_respond('%s','%s',1,'cant');" % (p, uid(2))
    first, second = (claim, claim if label == 'duplicate start' else respond)
    if label == 'time vs response':
        first = "select public.pick_availability_time('%s','%s',1,now()+interval '4 days');" % (p, uid(1))
    if label == 'start vs time':
        second = "select public.pick_availability_time('%s','%s',1,now()+interval '4 days');" % (p, uid(1))
    if label == 'response vs start':
        first, second = respond, claim
    if label == 'cancel vs response':
        first = "select public.pick_cancel('%s','%s',null);" % (p, uid(1))
    if label == 'revoke vs response':
        first = "delete from public.pick_participants where pick_id='%s' and user_id='%s';" % (p, uid(2))
    a = subprocess.Popen(PSQL, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    b = None
    try:
        a.stdin.write("set statement_timeout='15s';\n" + 'begin;\n' + first + '\n\\echo FIRST_LOCKED\n')
        a.stdin.flush()
        while True:
            line = a.stdout.readline()
            if not line:
                raise RuntimeError('First transaction failed: ' + a.stderr.read())
            if 'FIRST_LOCKED' in line:
                break
        b = subprocess.Popen(PSQL + ['-c', "set application_name='wtw_availability_race'; " + second], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        deadline = time.monotonic() + 10
        while sql("select count(*) from pg_stat_activity where application_name='wtw_availability_race' and wait_event_type='Lock'") != '1':
            if time.monotonic() > deadline:
                raise RuntimeError('Second transaction did not reach row-lock barrier')
        a.stdin.write('commit;\n\\q\n')
        a.stdin.flush()
        a.wait(timeout=10)
        out, err = b.communicate(timeout=10)
        if not b.returncode or not any((m in err for m in ['Time changed', 'Availability is closed', 'Swiping is starting', 'Pick not found', 'At least two Yes or Maybe'])):
            raise RuntimeError('Expected rejected loser: ' + err)
        results.append({'race': label, 'passed': True, 'outcome': err.splitlines()[0]})
    finally:
        if a.poll() is None:
            a.terminate()
        if b is not None and b.poll() is None:
            b.terminate()
print(json.dumps(results, indent=2))
