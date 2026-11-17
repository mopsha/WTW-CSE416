"""Deterministic time-suggestion races on a disposable local migrated database."""
import argparse
import json
import subprocess
import time
from urllib.parse import urlparse
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--dsn',required=True)
a=p.parse_args()
if not ('host=/tmp/' in a.dsn or urlparse(a.dsn).hostname in ('localhost','127.0.0.1','::1')):p.error('Local disposable database required')
base=['psql','-X','-qAt',a.dsn,'-v','ON_ERROR_STOP=1']
def query(sql):
 r=subprocess.run(base+['-c',sql],capture_output=True,text=True,timeout=20)
 if r.returncode:raise AssertionError(r.stderr)
 return r.stdout.strip()
def user(n):return 'a4000000-0000-4000-8000-'+str(n).zfill(12)
query("insert into auth.users(id,email,raw_user_meta_data) select ('a4000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'time-race'||n||'@example.invalid',jsonb_build_object('display_name','Time race '||n) from generate_series(1,3)n on conflict do nothing")
def setup():
 pick=query("select public.pick_create_options('%s',jsonb_build_object('category','food','center',jsonb_build_object('lat',40,'lng',-73),'radiusM',3000,'poolSize',10,'closeThreshold',100,'deadlineAt',null,'proposedAt',now()+interval '2 days','swipeDeadlineMinutes',60))->>'id'" % user(1))
 query("insert into public.pick_participants(pick_id,user_id) values('%s','%s'),('%s','%s')" % (pick,user(2),pick,user(3)))
 token=query("select public.pick_availability_claim('%s','%s')->>'token'" % (pick,user(1)))
 query("select public.pick_availability_finish('%s','%s','%s','[{\"placeId\":\"time-race-place\",\"snapshot\":{\"name\":\"Race place\",\"lat\":40,\"lng\":-73}}]')" % (pick,user(1),token))
 # The winner algorithm is tested separately: these races begin from a finished result.
 query("update public.picks set state='completed',winner_place_id='time-race-place',decided_at=now(),decided_by='clear_winner' where id='%s'" % pick)
 revision=query("select schedule_revision from public.picks where id='%s'" % pick)
 return pick,revision

def suggest(pick,revision,actor,days):return "select public.pick_time_suggest('%s','%s',%s,date_trunc('day',now())+interval '%s days')->>'id';" % (pick,user(actor),revision,days)
def act(pick,revision,suggestion,action,actor=1):return "select public.pick_time_suggestion_act('%s','%s','%s',%s,'%s');" % (pick,user(actor),suggestion,revision,action)
results=[]
cases=['duplicate submissions','two participants same time','two acceptances','two different acceptances','accept vs withdraw','withdraw vs accept','direct reschedule vs accept','accept vs direct reschedule','revoke vs accept','accept vs revoke','cancel vs accept','accept vs old RSVP','old RSVP vs accept','group removal vs accept','accept vs group removal','block vs accept','accept vs block']
for case in cases:
 pick,revision=setup()
 suggestion=query(suggest(pick,revision,2,3))
 accept=act(pick,revision,suggestion,'accept')
 withdraw=act(pick,revision,suggestion,'withdraw',2)
 direct="select public.pick_set_plan_time('%s','%s',date_trunc('day',now())+interval '4 days');" % (pick,user(1))
 revoke="delete from public.pick_participants where pick_id='%s' and user_id='%s';" % (pick,user(2))
 old_rsvp="select public.pick_rsvp('%s','%s','going',%s);" % (pick,user(2),revision)
 first,second=accept,accept
 success=case in ['duplicate submissions','two participants same time','two acceptances','accept vs direct reschedule','accept vs revoke','old RSVP vs accept','accept vs group removal','accept vs block']
 if case in ['duplicate submissions','two participants same time']:
  # Hold an actual INSERT lock in the first transaction for an otherwise empty instant.
  first=suggest(pick,revision,2,5)
  second=suggest(pick,revision,2 if case=='duplicate submissions' else 3,5)
 elif case=='accept vs withdraw':first,second=accept,withdraw
 elif case=='withdraw vs accept':first,second=withdraw,accept
 elif case=='direct reschedule vs accept':first,second=direct,accept
 elif case=='accept vs direct reschedule':first,second=accept,direct
 elif case=='revoke vs accept':first,second=revoke,accept
 elif case=='accept vs revoke':first,second=accept,revoke
 elif case=='cancel vs accept':first,second="update public.picks set state='canceled' where id='%s';" % pick,accept
 elif case=='accept vs old RSVP':first,second=accept,old_rsvp
 elif case=='old RSVP vs accept':first,second=old_rsvp,accept
 elif case=='two different acceptances':
  other=query(suggest(pick,revision,3,4))
  second=act(pick,revision,other,'accept')
 elif 'group removal' in case:
  group=query("insert into public.groups(name,owner_id) values('Time race group','%s') returning id" % user(1))
  query("insert into public.group_members(group_id,user_id,role) values('%s','%s','owner'),('%s','%s','member')" % (group,user(1),group,user(2)))
  query("update public.picks set group_id='%s' where id='%s'" % (group,pick))
  removal="select public.group_remove_member('%s','%s','%s');" % (user(1),group,user(2))
  first,second=(removal,accept) if case.startswith('group') else (accept,removal)
 elif 'block' in case:
  block="insert into public.blocks(blocker_id,blocked_id) values('%s','%s');" % (user(1),user(2))
  first,second=(block,accept) if case.startswith('block') else (accept,block)

 holder=subprocess.Popen(base,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
 contender=None
 try:
  holder.stdin.write("set statement_timeout='15s'; begin;\n"+first+'\n\\echo LOCKED\n');holder.stdin.flush()
  while True:
   line=holder.stdout.readline()
   if not line:raise AssertionError(holder.stderr.read())
   if 'LOCKED' in line:break
  contender=subprocess.Popen(base+['-c',"set application_name='wtw_time_race';set statement_timeout='15s';"+second],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  limit=time.monotonic()+10
  while query("select count(*) from pg_stat_activity where application_name='wtw_time_race' and datname=current_database() and wait_event_type='Lock'")!='1':
   if time.monotonic()>limit:raise AssertionError('Contender did not reach lock barrier')
  holder.stdin.write('commit;\n\\q\n');holder.stdin.flush();holder.wait(timeout=10)
  output,error=contender.communicate(timeout=10)
  if success and contender.returncode:raise AssertionError(error)
  if not success and not contender.returncode:raise AssertionError('Stale mutation unexpectedly succeeded: '+output)
  if not success and not any(x in error for x in ['no longer current','Pick not found','Suggestion not found','plan time changed']):raise AssertionError(error)
  if case in ['duplicate submissions','two participants same time']:
   assert query("select count(*) from public.pick_time_suggestions where pick_id='%s' and plan_at=date_trunc('day',now())+interval '5 days'" % pick)=='1'
  if case in ['two acceptances','accept vs withdraw','withdraw vs accept','direct reschedule vs accept','accept vs direct reschedule','revoke vs accept','accept vs revoke','cancel vs accept','accept vs old RSVP','old RSVP vs accept']:
   expected='accepted' if case in ['two acceptances','accept vs withdraw','accept vs direct reschedule','accept vs revoke','accept vs old RSVP','old RSVP vs accept'] else ('withdrawn' if case=='withdraw vs accept' else ('superseded' if case=='direct reschedule vs accept' else 'pending'))
   assert query("select status from public.pick_time_suggestions where id='%s'" % suggestion)==expected
  if case=='two different acceptances':
   assert query("select status from public.pick_time_suggestions where id='%s'" % suggestion)=='accepted'
   assert query("select status from public.pick_time_suggestions where id='%s'" % other)=='superseded'
  if 'group removal' in case or 'block' in case:
   expected='accepted' if case.startswith('accept') else 'superseded'
   assert query("select status from public.pick_time_suggestions where id='%s'" % suggestion)==expected
  if 'RSVP' in case:assert query("select count(*) from public.pick_rsvps where pick_id='%s'" % pick)=='0'
  assert query("select winner_place_id from public.picks where id='%s'" % pick)=='time-race-place'
  results.append({'case':case,'passed':True})
 finally:
  if holder.poll() is None:holder.terminate()
  if contender is not None and contender.poll() is None:contender.terminate()
  if 'block' in case:query("delete from public.blocks where blocker_id='%s' and blocked_id='%s'" % (user(1),user(2)))
print(json.dumps(results,indent=2))
