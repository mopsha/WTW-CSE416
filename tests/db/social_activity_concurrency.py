"""Verify Phase 2 activity deduplication with overlapping local database transactions."""

import argparse
import json
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


def query(sql):
    result = subprocess.run(command, input=sql, text=True, capture_output=True, timeout=10)
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


def overlap(first, second):
    label = f"social-activity-{uuid4()}"
    with subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True) as holder:
        holder.stdin.write("set statement_timeout='8s'; begin;\n" + first + "\n\\echo READY\n")
        holder.stdin.flush()
        first_output = holder.stdout.readline().strip()
        assert holder.stdout.readline().strip() == "READY", first_output
        with subprocess.Popen(
            command + ["-c", "set statement_timeout='8s'; " + second],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env={**os.environ, "PGAPPNAME": label},
        ) as waiter:
            try:
                deadline = time.monotonic() + 5
                while query(f"""
                    select count(*) from pg_stat_activity
                    where application_name='{label}' and wait_event_type='Lock'
                """) != "1":
                    assert waiter.poll() is None and time.monotonic() < deadline, label
                    time.sleep(0.05)
                holder.stdin.write("commit;\n")
            finally:
                holder.stdin.close()
            output, error = waiter.communicate(timeout=10)
            assert waiter.returncode == 0, error
        assert holder.wait(timeout=10) == 0
    return first_output, output.strip()


owner, guest, extra = (str(uuid4()) for _ in range(3))
owner_name, guest_name = (f"act_{uuid4().hex[:12]}" for _ in range(2))
try:
    query(f"""
        begin;
        insert into auth.users(id,email) values
          ('{owner}','{owner}@example.invalid'),('{guest}','{guest}@example.invalid'),
          ('{extra}','{extra}@example.invalid');
        update public.profiles set username='{owner_name}' where id='{owner}';
        update public.profiles set username='{guest_name}' where id='{guest}';
        insert into public.friendships(requester_id,addressee_id,status,accepted_at)
        values ('{owner}','{extra}','accepted',now());
        commit;
    """)
    request = f"select public.friend_request_activity('{owner}', '{guest_name}', '{guest}');"
    first, second = overlap(request, request)
    assert "notificationId" in json.loads(first) and "notificationId" not in json.loads(second)
    assert query(f"""
        select count(*) from public.activity_feed('{guest}',51) where type='friend_request'
    """) == "1"

    query(f"select public.friend_remove('{owner}', '{guest}');")
    first, second = overlap(
        request, f"select public.friend_request_activity('{guest}', '{owner_name}', '{owner}');"
    )
    assert "notificationId" in json.loads(first)
    accepted = json.loads(second)
    assert accepted["relationship"] == "friends" and "notificationId" not in accepted
    assert query(f"""
        select count(*) from public.activity_feed('{owner}',51) where type='friend_accepted'
    """) == "1"
    assert query(f"""
        select count(*) from public.activity_feed('{guest}',51) where type='friend_request'
    """) == "0"

    hang = query(f"""
        select public.hang_create('{owner}',jsonb_build_object('activity','Coffee',
          'audience','all_friends','startsAt',now()+interval '1 hour',
          'expiresAt',now()+interval '2 hours'))->>'id';
    """)
    overlap(
        f"select public.hang_respond('{hang}','{guest}','down');",
        f"select public.hang_respond('{hang}','{extra}','down');",
    )
    assert query(f"""
        select activity->>'replyCount' from public.activity_feed('{owner}',51)
        where type='hang_rsvp'
    """) == "2"
    assert query(f"""
        select count(*) from public.notifications
        where user_id='{owner}' and type='hang_rsvp' and payload->>'hangId'='{hang}'
    """) == "1"
    print("PASS: concurrent duplicate and reciprocal friend requests, and concurrent Hang RSVPs.")
finally:
    query(f"delete from auth.users where id in ('{owner}', '{guest}', '{extra}');")
