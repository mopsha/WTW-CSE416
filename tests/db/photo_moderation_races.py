"""Deterministic SQL races; caller owns disposable fixtures and Storage lifecycle.

Used by the real local-Supabase test and disposable PostgreSQL validation. This
module never creates/deletes Storage metadata or chooses an environment.
"""
import concurrent.futures
import subprocess
import time
import uuid


def exercise_photo_moderation_races(query, base, owner, reporter, path, replacement_path):
    def wait_for(tag, predicate):
        for _ in range(250):
            if query(f"select count(*) from pg_stat_activity where application_name='{tag}' and {predicate};").stdout.strip() == '1':
                return
            time.sleep(0.01)
        raise AssertionError(f'Expected controlled database interleaving: {predicate}')

    def ordered(first, second, during=None):
        first_tag, second_tag = 'photo_first_' + uuid.uuid4().hex, 'photo_second_' + uuid.uuid4().hex
        holder = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                                  stderr=subprocess.PIPE, text=True)
        try:
            holder.stdin.write(f"set application_name='{first_tag}'; begin; {first}\n")
            holder.stdin.flush()
            wait_for(first_tag, "state='idle in transaction'")
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(query, f"set application_name='{second_tag}'; {second}", False)
                try:
                    wait_for(second_tag, "wait_event_type='Lock'")
                    if during:
                        during(second_tag)
                finally:
                    # Always release the lock before joining the waiting worker.
                    holder.stdin.write('commit;\n')
                    holder.stdin.close()
                assert holder.wait(timeout=5) == 0, holder.stderr.read()
                return future.result(timeout=10)
        finally:
            if holder.poll() is None:
                holder.terminate()
                holder.wait(timeout=5)

    def revision():
        return int(query(f"select avatar_revision from public.profiles where id='{owner}';").stdout.strip())

    def reset_photo():
        query(f"select public.avatar_change('{owner}',{revision()},'{path}');")
        return revision()

    def report_sql(rev):
        return f"select public.avatar_report_create('{reporter}','{owner}',{rev},'Race test');"

    def report_id(rev):
        return query(f"select id from public.reports where reporter_id='{reporter}' and target_id='{owner}' and photo_revision={rev};").stdout.strip()

    def owner_unchanged(rev):
        assert revision() == rev
        assert query(f"select avatar_path from public.profiles where id='{owner}';").stdout.strip() == path

    rev = reset_photo()
    result = ordered(report_sql(rev), f"select public.avatar_change('{owner}',{rev},null);")
    assert result.returncode == 0 and '"previousPath": null' in result.stdout, 'Report-first lost pinned evidence'

    rev = reset_photo()
    result = ordered(f"select public.avatar_change('{owner}',{rev},null);", report_sql(rev))
    assert result.returncode != 0 and 'Nothing to report here' in result.stderr, 'Retirement-first accepted stale report'

    rev = reset_photo()
    before = int(query(f"select count(*) from public.rate_limit_events where user_id='{reporter}' and action='report';").stdout.strip())
    result = ordered(report_sql(rev), report_sql(rev))
    assert result.returncode == 0 and result.stdout.strip() == report_id(rev), 'Concurrent duplicate not idempotent'
    assert int(query(f"select count(*) from public.rate_limit_events where user_id='{reporter}' and action='report';").stdout.strip()) == before + 1

    for case in ['deleted', 'expired-cleared', 'wall-clock-expired']:
        rev = reset_photo()
        query(report_sql(rev))
        rid = report_id(rev)

        def invalidate(tag):
            if case == 'deleted':
                query(f"delete from public.reports where id='{rid}';")
            elif case == 'expired-cleared':
                query(f"update public.reports set photo_expires_at=clock_timestamp()-interval '1 second' where id='{rid}'; select public.avatar_expire_evidence();")
            else:
                # Deadline is AFTER the blocked transaction began but BEFORE it resumes:
                # a transaction-start now() comparison would incorrectly accept it.
                query(f"update public.reports set photo_expires_at=(select xact_start from pg_stat_activity where application_name='{tag}')+interval '100 milliseconds' where id='{rid}';")
                for _ in range(100):
                    if query(f"select photo_expires_at<=clock_timestamp() from public.reports where id='{rid}';").stdout.strip() == 't':
                        break
                    time.sleep(0.01)
                else:
                    raise AssertionError('Controlled evidence deadline did not expire')

        result = ordered(f"select id from public.profiles where id='{owner}' for update;",
                         f"select public.avatar_moderation_remove('{rid}');", invalidate)
        assert result.returncode != 0 and ('Evidence unavailable' in result.stderr or 'Report unavailable' in result.stderr), case
        owner_unchanged(rev)

    rev = reset_photo()
    query(report_sql(rev))
    rid = report_id(rev)
    result = ordered(f"select public.avatar_change('{owner}',{rev},'{replacement_path}');",
                     f"select public.avatar_moderation_remove('{rid}');")
    assert result.returncode != 0 and 'Photo changed' in result.stderr
    assert query(f"select avatar_path from public.profiles where id='{owner}';").stdout.strip() == replacement_path

    rev = reset_photo()
    query(report_sql(rev))
    rid = report_id(rev)
    result = ordered(f"select public.avatar_moderation_remove('{rid}');",
                     f"select public.avatar_change('{owner}',{rev},'{replacement_path}');")
    assert result.returncode != 0 and 'Photo changed' in result.stderr
    assert query(f"select count(*) from public.reports where id='{rid}' and reviewed_at is not null and review_note like 'Removed reported%';").stdout.strip() == '1'
    assert query(f"select avatar_path is null from public.profiles where id='{owner}';").stdout.strip() == 't'
    reset_photo()
    print('PASS forced photo reporting/removal/expiry/duplicate/replacement orderings')
