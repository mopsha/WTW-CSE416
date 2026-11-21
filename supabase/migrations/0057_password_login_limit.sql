-- Username + password login (Alan). Spec: docs/sign-in.md.
-- POST /auth/password-login signs in from the API's server, so Supabase's per-IP limits can't
-- tell users apart. The API checks several limits at once (_shared/api/signIn.ts):
--   * per account + client: 10 / 15 min (a stranger's junk tries can't lock you out),
--   * per client: 20 / 15 min across all accounts (no spraying one password over usernames),
--   * global: a backstop for clients that rotate addresses.
-- Subjects are stored hashed, so no email or IP lands in rate_limit_counters. Attempts that fail
-- for reasons other than a wrong password are refunded. The sweep deletes buckets older than a
-- day (purge_login_limits). /usernames/available uses the existing username lookup quota.
-- Numbering: 0053–0055 are the pick-flow and Hang PRs, 0056 is #78.

alter table public.rate_limit_counters drop constraint rate_limit_counters_scope_check;
alter table public.rate_limit_counters add constraint rate_limit_counters_scope_check
 check (scope in ('create','start','refresh','discover','avatar_read','avatar_resolve',
  'username_lookup','discover_photo','password_login'));

create function private.login_bucket() returns text
language sql stable set search_path = '' as $$
  select to_char(date_bin('15 minutes', now(), timestamptz 'epoch') at time zone 'UTC',
                 'YYYY-MM-DD"T"HH24:MI')
$$;

-- Counts one attempt against every subject, or against none: if any subject is at its limit
-- the attempt is refused and nothing is spent, so a client that is already blocked can't use
-- up the global (or another shared) budget and lock out other people. Rows are locked in a
-- fixed order, so concurrent attempts can't deadlock or overshoot a limit. Returns the bucket
-- that was charged (pass it to refund_login_limit), or null when refused.
create function public.consume_login_limit(p_subjects text[], p_limits integer[]) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_bucket text := private.login_bucket();
  v_calls integer;
  r record;
begin
  if p_subjects is null or p_limits is null or cardinality(p_subjects) = 0
     or array_length(p_subjects, 1) is distinct from array_length(p_limits, 1) then
    return null;
  end if;
  for r in select md5(lower(s)) as subject, min(l) as l from unnest(p_subjects, p_limits) as u(s, l)
           group by 1 order by 1 loop
    insert into public.rate_limit_counters (scope, subject, bucket, calls)
    values ('password_login', r.subject, v_bucket, 0)
    on conflict (scope, subject, bucket) do nothing;
    select calls into v_calls from public.rate_limit_counters
    where scope = 'password_login' and subject = r.subject and bucket = v_bucket
    for update;
    if v_calls >= r.l then return null; end if;
  end loop;
  update public.rate_limit_counters set calls = calls + 1
  where scope = 'password_login' and bucket = v_bucket
    and subject in (select md5(lower(s)) from unnest(p_subjects) as u(s));
  return v_bucket;
end $$;

-- Gives back an attempt (the sign-in failed for a reason that isn't the user's password), in
-- the bucket it was charged to, so a refund never lands on a newer window's attempts.
create function public.refund_login_limit(p_subjects text[], p_bucket text) returns void
language sql security definer set search_path = '' as $$
  update public.rate_limit_counters set calls = greatest(calls - 1, 0)
  where scope = 'password_login' and bucket = p_bucket
    and subject in (select md5(lower(s)) from unnest(p_subjects) as u(s))
$$;

-- Runs on every sweep (placeCacheStore.ts). Buckets are 15 minutes; keep a day.
create function public.purge_login_limits() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_removed integer;
begin
  delete from public.rate_limit_counters
  where scope = 'password_login'
    and bucket < to_char((now() - interval '1 day') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI');
  get diagnostics v_removed = row_count;
  return v_removed;
end $$;

-- /usernames/available counts against the same lookup quota as /people and /friends/search.
create function public.consume_username_lookup(p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.username_lookup_limit(p_user_id);
end $$;

revoke all on function private.login_bucket() from public, anon, authenticated;
revoke all on function public.consume_login_limit(text[], integer[]),
  public.refund_login_limit(text[], text), public.purge_login_limits(),
  public.consume_username_lookup(uuid) from public, anon, authenticated;
grant execute on function public.consume_login_limit(text[], integer[]),
  public.refund_login_limit(text[], text), public.purge_login_limits(),
  public.consume_username_lookup(uuid) to service_role;
