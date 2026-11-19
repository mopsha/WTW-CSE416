-- Username + password login (Alan). Spec: docs/sign-in.md.
-- POST /auth/password-login signs in from the API's server, so Supabase's per-IP limits can't
-- tell users apart. This adds a per-account limit: 10 attempts per 15 minutes for each account
-- named (by email, or by username when it matches nobody). The subject is stored hashed, so
-- no email address lands in rate_limit_counters. 0051 is #78's Google taste learning.

alter table public.rate_limit_counters drop constraint rate_limit_counters_scope_check;
alter table public.rate_limit_counters add constraint rate_limit_counters_scope_check
 check (scope in ('create','start','refresh','discover','avatar_read','avatar_resolve',
  'username_lookup','discover_photo','password_login'));

create function public.consume_login_limit(p_subject text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_calls integer;
begin
  if p_subject is null or length(p_subject) = 0 then return false; end if;
  insert into public.rate_limit_counters (scope, subject, bucket, calls)
  values ('password_login', md5(lower(p_subject)),
          to_char(date_bin('15 minutes', now(), timestamptz 'epoch'), 'YYYY-MM-DD"T"HH24:MI'), 1)
  on conflict (scope, subject, bucket) do update set calls = public.rate_limit_counters.calls + 1
    where public.rate_limit_counters.calls < 10
  returning calls into v_calls;
  return v_calls is not null;
end $$;
revoke all on function public.consume_login_limit(text) from public, anon, authenticated;
grant execute on function public.consume_login_limit(text) to service_role;
