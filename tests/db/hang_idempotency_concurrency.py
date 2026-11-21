"""Verify concurrent Hang retries against a disposable local database migrated through 0054."""

import argparse
import json
import subprocess
import time
from urllib.parse import urlparse
from uuid import uuid4

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--dsn", required=True)
args = parser.parse_args()
if not ("host=/tmp/" in args.dsn or urlparse(args.dsn).hostname in ("localhost", "127.0.0.1", "::1")):
    parser.error("Use a disposable local database only.")
command = ["psql", "-X", "-qAt", args.dsn, "-v", "ON_ERROR_STOP=1"]
author, recipient, request_id = (str(uuid4()) for _ in range(3))


def query(statement):
    return subprocess.run(command, input=statement, capture_output=True, text=True, timeout=12, check=True).stdout.strip()


def send(activity):
    payload = json.dumps(dict(activity=activity, audience="all_friends", startNow=True, requestId=request_id))
    return f"select public.hang_create('{author}', '{payload}');\n"


with subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) as first:
    try:
        query(f"""
        insert into auth.users(id,email) values ('{author}','{author}@example.invalid'),('{recipient}','{recipient}@example.invalid');
        insert into public.friendships(requester_id,addressee_id,status,accepted_at)
          values ('{author}','{recipient}','accepted',now());
        """)
        first.stdin.write("set statement_timeout='8s'; begin;\n" + send("Original Hang") + "\\echo READY\n")
        first.stdin.flush()
        post = json.loads(first.stdout.readline())
        assert first.stdout.readline().strip() == "READY"
        second_command = command + [
            "-v", "VERBOSITY=verbose", "-c", "set statement_timeout='8s'", "-c", send("Different Hang")
        ]
        with subprocess.Popen(second_command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) as second:
            deadline = time.monotonic() + 5
            while query("select count(*) from pg_stat_activity where wait_event='advisory' and query like '%Different Hang%'") != "1":
                assert time.monotonic() < deadline, "Concurrent request never reached the advisory lock"
                time.sleep(0.05)
            first.stdin.write("commit;\n")
            first.stdin.flush()
            _, conflict = second.communicate(timeout=10)
            assert second.returncode != 0 and "PT409" in conflict, conflict
        retry = json.loads(query(send("Original Hang")))
        assert retry["id"] == post["id"] and retry["recipientIds"] == []
        assert post["recipientIds"] == [recipient]
        assert query(f"select count(*) from public.notifications where payload->>'hangId'='{post['id']}';") == "1"
        print("Concurrent mismatch rejected; identical replay returned one Hang and one invitation.")
    finally:
        first.stdin.close()
        first.wait(timeout=10)
        query(f"delete from auth.users where id in ('{author}', '{recipient}');")
