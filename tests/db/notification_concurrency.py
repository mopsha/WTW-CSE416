"""Verify an explicit invite overlapping Pick start against disposable PostgreSQL."""

import argparse
import os
import shlex
import subprocess
import time
from urllib.parse import urlsplit
from uuid import uuid4

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--dsn", required=True, help="Disposable PostgreSQL connection string")
args = parser.parse_args()
dsn = urlsplit(args.dsn)
loopback = (
    dsn.scheme in ("postgres", "postgresql")
    and dsn.hostname in ("localhost", "127.0.0.1", "::1")
    and not dsn.query
)
socket_host = dict(
    part.split("=", 1) for part in shlex.split(args.dsn) if "=" in part
).get("host", "")
if not (loopback or socket_host.startswith(("/tmp/", "/private/tmp/"))):
    parser.error("Use a disposable local database over a temporary Unix socket or loopback TCP.")
command = ["psql", "-XqAt", args.dsn, "-v", "ON_ERROR_STOP=1"]
host, guest, place = (str(uuid4()) for _ in range(3))
starter_name = f"notification-start-{uuid4()}"


def query(sql):
    result = subprocess.run(command, input=sql, capture_output=True, text=True, timeout=10)
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


try:
    pick = query(f"""
        begin;
        insert into auth.users(id,email) values
          ('{host}','{host}@example.invalid'),('{guest}','{guest}@example.invalid');
        insert into public.friendships(requester_id,addressee_id,status,accepted_at)
          values ('{host}','{guest}','accepted',now());
        insert into public.push_tokens(token,user_id,platform)
          values ('ExpoPushToken[{guest}]','{guest}','ios');
        select public.pick_create('{host}','food',40,-73,1000,5,null,100)->>'id';
        commit;
    """)
    with subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True) as invite:
        invite.stdin.write(
            "set statement_timeout='8s'; begin;\n"
            f"select public.pick_invite('{pick}','{host}',array['{guest}']::uuid[]);\n"
            "\\echo INVITED\n"
        )
        invite.stdin.flush()
        assert invite.stdout.readline().strip() == "1"
        assert invite.stdout.readline().strip() == "INVITED"

        start_sql = (
            f"select public.pick_start('{pick}', '{host}', "
            f"""'[{{"placeId":"{place}","snapshot":{{"name":"Cafe","lat":40,"lng":-73}}}}]');"""
        )
        with subprocess.Popen(
            command + ["-c", "set statement_timeout='8s'", "-c", start_sql],
            env={**os.environ, "PGAPPNAME": starter_name},
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        ) as starter:
            try:
                deadline = time.monotonic() + 5
                while query(
                    f"select count(*) from pg_stat_activity where application_name='{starter_name}' "
                    "and wait_event_type='Lock';"
                ) != "1":
                    assert starter.poll() is None, "Start did not wait on the invitation transaction"
                    assert time.monotonic() < deadline, "Start did not reach the row lock"
                    time.sleep(0.05)
                invite.stdin.write("commit;\n")
                invite.stdin.flush()
                _, failure = starter.communicate(timeout=10)
                assert starter.returncode == 0, failure
            finally:
                invite.stdin.close()
                invite.wait(timeout=10)

    assert query(f"select state from public.picks where id='{pick}';") == "swiping"
    addition = query(f"""
      select public.notification_record(array['{guest}']::uuid[], 'added_to_pick', '{pick}',
        '{{"draftAddition":false}}');
    """)
    started = query(f"select public.notification_record(array['{guest}']::uuid[], 'pick_started', '{pick}', '{{}}');")
    assert query(f"select payload->>'draftAddition' from public.notifications where id='{addition}';") == "true"
    assert query(f"select count(*) from public.notification_feed('{guest}',51) where id='{addition}';") == "1"
    assert query(f"select count(*) from public.notification_push_targets(array['{addition}']::uuid[]);") == "0"
    assert query(f"select count(*) from public.notification_push_targets(array['{started}']::uuid[]);") == "1"
    assert not query(f"select public.notification_record(array['{guest}']::uuid[], 'pick_started', '{pick}', '{{}}');")
    print("Concurrent explicit invite remained inbox-only after start; the start notice alone could push.")
finally:
    query(f"delete from public.picks where host_id='{host}'; delete from auth.users where id in ('{host}','{guest}');")
