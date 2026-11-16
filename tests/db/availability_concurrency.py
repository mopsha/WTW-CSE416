"""Deterministic two-connection regressions; disposable local migrated database only."""
import argparse
import json
import subprocess
import time
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
    return 'ac000000-0000-4000-8000-' + str(n).zfill(12)

query("insert into auth.users(id,email,raw_user_meta_data) select ('ac000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'race'||n||'@example.invalid',jsonb_build_object('display_name','Race '||n) from generate_series(1,3)n on conflict do nothing")
candidates = '[{"placeId":"race-a","snapshot":{"name":"A","lat":40,"lng":-73}},{"placeId":"race-b","snapshot":{"name":"B","lat":40,"lng":-73}}]'
ranking = "jsonb_build_object('state','final_vote','winnerPlaceId',null,'voteDeadlineAt',now()+interval '30 minutes','rows','[{\"place_id\":\"race-a\",\"rank\":1,\"score\":80,\"finalist\":true},{\"place_id\":\"race-b\",\"rank\":2,\"score\":70,\"finalist\":true}]'::jsonb)"

def setup(initializing=False):
    pick = query("select public.pick_create_options('%s',jsonb_build_object('category','food','center',jsonb_build_object('lat',40,'lng',-73),'radiusM',3000,'poolSize',10,'closeThreshold',100,'deadlineAt',null,'proposedAt',now()+interval '3 days','swipeDeadlineMinutes',60))->>'id'" % user(1))
    query("insert into pick_participants(pick_id,user_id) values('%s','%s')" % (pick, user(2)))
    if not initializing:
        token = query("select public.pick_availability_claim('%s','%s')->>'token'" % (pick, user(1)))
        query("select public.pick_availability_finish('%s','%s','%s','%s')" % (pick, user(1), token, candidates))
    return pick

def close(pick, actor='host'):
    who = "'%s'" % user(1) if actor == 'host' else 'null'
    return "select public.pick_close_apply('%s','%s',%s,(select version::text from public.picks where id='%s'),%s);" % (pick, actor, who, pick, ranking)

results = []
for case in ['close vs Yes', 'Yes vs close', 'deadline vs Maybe', 'first swipe vs Cant', 'Cant vs first swipe', 'manual vs automatic close', 'cancel vs response', 'revoke vs response', 'duplicate initialization']:
    pick = setup(case == 'duplicate initialization')
    response = "select public.pick_availability_respond('%s','%s',1,'yes');" % (pick, user(2))
    first, second = close(pick), response
    if case == 'Yes vs close':
        first, second = response, close(pick)
    elif case == 'deadline vs Maybe':
        query("update public.picks set deadline_at=now()-interval '1 second' where id='%s'" % pick)
        first, second = close(pick, 'system'), response.replace("'yes'", "'maybe'")
    elif case in ('first swipe vs Cant', 'Cant vs first swipe'):
        query(response)
        swipe = "select public.heartbeat_upsert_swipe('%s','%s','race-a',2);" % (pick, user(2))
        decline = response.replace("'yes'", "'cant'")
        first, second = (swipe, decline) if case.startswith('first') else (decline, swipe)
    elif case == 'manual vs automatic close':
        first, second = close(pick), close(pick, 'system')
    elif case == 'cancel vs response':
        first = "select public.pick_cancel('%s','%s',null);" % (pick, user(1))
    elif case == 'revoke vs response':
        first = "delete from public.pick_participants where pick_id='%s' and user_id='%s';" % (pick, user(2))
    elif case == 'duplicate initialization':
        first = second = "select public.pick_availability_claim('%s','%s');" % (pick, user(1))
    holder = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    contender = None
    try:
        holder.stdin.write("set statement_timeout='15s'; begin;\n" + first + '\n\\echo LOCKED\n')
        holder.stdin.flush()
        while True:
            line = holder.stdout.readline()
            if not line:
                raise AssertionError(holder.stderr.read())
            if 'LOCKED' in line:
                break
        contender = subprocess.Popen(base + ['-c', "set application_name='wtw_immediate_race'; set statement_timeout='15s'; " + second], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        limit = time.monotonic() + 10
        while query("select count(*) from pg_stat_activity where application_name='wtw_immediate_race' and wait_event_type='Lock'") != '1':
            if time.monotonic() > limit:
                raise AssertionError('Second connection never reached lock barrier')
        holder.stdin.write('commit;\n\\q\n')
        holder.stdin.flush()
        holder.wait(timeout=10)
        _, error = contender.communicate(timeout=10)
        if not contender.returncode:
            raise AssertionError('Expected a rejected stale/conflicting contender')
        if not any(text in error for text in ['closed', 'changed', 'first swipe', 'Confirm Yes', 'Pick not found', 'initializing']):
            raise AssertionError(error)
        if case == 'Yes vs close':
            query(close(pick))  # canonical closer retries a version conflict
            assert query("select count(*) from public.pick_voting_cohort where pick_id='%s' and user_id='%s'" % (pick, user(2))) == '1'
        if case == 'close vs Yes':
            assert query("select count(*) from public.pick_voting_cohort where pick_id='%s' and user_id='%s'" % (pick, user(2))) == '0'
        if case == 'first swipe vs Cant':
            assert query("select count(*) from public.preferences where pick_id='%s' and user_id='%s'" % (pick, user(2))) == '1'
        if case == 'Cant vs first swipe':
            assert query("select count(*) from public.preferences where pick_id='%s' and user_id='%s'" % (pick, user(2))) == '0'
        results.append({'race': case, 'passed': True})
    finally:
        if holder.poll() is None:
            holder.terminate()
        if contender is not None and contender.poll() is None:
            contender.terminate()
print(json.dumps(results, indent=2))
