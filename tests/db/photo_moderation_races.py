"""Deterministic SQL races; caller owns disposable fixtures and Storage lifecycle.

Used by the real local-Supabase test and disposable PostgreSQL validation. This
module never creates/deletes Storage metadata or chooses an environment.
"""
import concurrent.futures
import subprocess
import time
import uuid


def exercise_photo_moderation_races(query, base, owner, reporter, path, replacement_path, other_reporter=None):
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
    if other_reporter:
        # Independent scenario quota fixtures; these users are disposable.
        query(f"delete from public.rate_limit_events where user_id='{reporter}' and action='report';")
        rev = reset_photo()
        query(report_sql(rev))
        rid = report_id(rev)
        query(f"update public.reports set photo_expires_at=clock_timestamp()-interval '1 second',review_note='Prior review' where id='{rid}'; select public.avatar_expire_evidence();")
        historical = query(f"select public.avatar_moderation_evidence('{rid}');", False)
        assert historical.returncode != 0 and 'Evidence unavailable' in historical.stderr
        assert path in query(f"select public.avatar_moderation_current('{rid}');").stdout
        # A second report commits first; current removal must include it despite expired source evidence.
        first = f"select public.avatar_report_create('{other_reporter}','{owner}',{rev},'Other reporter');"
        result = ordered(first, f"select public.avatar_moderation_remove_current('{rid}',{rev},'{path}');")
        assert result.returncode == 0 and '"resolvedReports": 2' in result.stdout
        assert query(f"select count(*) from public.reports where target_id='{owner}' and photo_revision={rev} and reviewed_at is not null;").stdout.strip() == '2'
        assert query(f"select count(*) from public.reports where id='{rid}' and review_note like 'Prior review%';").stdout.strip() == '1'
        # Conversely, removal holds the profile first: the arriving new report is rejected.
        rev = reset_photo()
        query(report_sql(rev))
        rid = report_id(rev)
        result = ordered(f"select public.avatar_moderation_remove_current('{rid}',{rev},'{path}');",
                         f"select public.avatar_report_create('{other_reporter}','{owner}',{rev},'Late reporter');")
        assert result.returncode != 0 and 'Nothing to report here' in result.stderr
        assert query(f"select count(*) from public.reports where target_id='{owner}' and photo_revision={rev};").stdout.strip() == '1'
        # A stale current-review snapshot cannot remove a replacement.
        rev = reset_photo()
        query(report_sql(rev))
        rid = report_id(rev)
        result = ordered(f"select public.avatar_change('{owner}',{rev},'{replacement_path}');",
                         f"select public.avatar_moderation_remove_current('{rid}',{rev},'{path}');")
        assert result.returncode != 0 and 'Photo changed' in result.stderr
        stale = query(f"select public.avatar_moderation_current('{rid}');", False)
        assert stale.returncode != 0 and 'Photo changed' in stale.stderr
        assert query(f"select avatar_path from public.profiles where id='{owner}';").stdout.strip() == replacement_path
        reset_photo()
    print('PASS forced photo reporting/removal/expiry/duplicate/replacement orderings')


def exercise_mutual_photo_reports(query, base, first_user, second_user):
    """A test-only insert barrier forces both RPCs into the FK-locking window."""
    suffix = uuid.uuid4().hex
    function = f'private.photo_mutual_barrier_{suffix}'
    trigger = f'photo_mutual_barrier_{suffix}'
    latch = uuid.uuid4().int % 2147483647
    controller_tag = f'photo_latch_{suffix}'
    tags = [f'photo_mutual_a_{suffix}', f'photo_mutual_b_{suffix}']
    query(f"""create function {function}() returns trigger language plpgsql set search_path='' as $$ begin
      if new.target_kind='profile_photo' and new.reporter_id in ('{first_user}','{second_user}')
       and new.target_id in ('{first_user}','{second_user}') then
       perform pg_catalog.pg_advisory_xact_lock({latch}); end if;
      return new; end $$;
      create trigger {trigger} before insert on public.reports for each row execute function {function}();""")
    holder = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                              stderr=subprocess.PIPE, text=True)
    try:
        holder.stdin.write(f"set application_name='{controller_tag}'; begin; select pg_advisory_xact_lock({latch});\n")
        holder.stdin.flush()
        for _ in range(200):
            if query(f"select count(*) from pg_stat_activity where application_name='{controller_tag}' and state='idle in transaction';").stdout.strip() == '1':
                break
            time.sleep(0.01)
        else:
            raise AssertionError('Mutual-report barrier not ready')
        revisions = [int(query(f"select avatar_revision from public.profiles where id='{u}';").stdout.strip()) for u in [first_user, second_user]]
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            workers = [pool.submit(query, f"\\set VERBOSITY verbose\nset application_name='{tags[i]}'; set deadlock_timeout='100ms'; select public.avatar_report_create('{who}','{target}',{revisions[1-i]},'Mutual report');", False)
                       for i, (who, target) in enumerate([(first_user, second_user), (second_user, first_user)])]
            try:
                for _ in range(200):
                    if query(f"select count(*) from pg_stat_activity where application_name in ('{tags[0]}','{tags[1]}') and wait_event_type='Lock';").stdout.strip() == '2':
                        break
                    time.sleep(0.01)
                else:
                    raise AssertionError('Mutual reports did not reach forced lock contention')
            finally:
                holder.stdin.write('commit;\n')
                holder.stdin.close()
            assert holder.wait(timeout=5) == 0
            results = [worker.result(timeout=10) for worker in workers]
        assert all(result.returncode == 0 for result in results), '\n'.join(result.stderr for result in results)
        print('PASS deterministic mutual photo reports: no 40P01')
    finally:
        if holder.poll() is None:
            holder.terminate()
            holder.wait(timeout=5)
        query(f'drop trigger if exists {trigger} on public.reports; drop function if exists {function}();')
