-- Josh: scheduling only. Lifecycle decisions remain in the canonical API closers.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

create index picks_swipe_deadline_idx on public.picks (deadline_at, id)
  where state = 'swiping' and deadline_at is not null;
create index picks_vote_deadline_idx on public.picks (vote_deadline_at, id)
  where state = 'final_vote' and vote_deadline_at is not null;

-- Runs as the scheduling database owner, never as an app caller.
-- Vault values are injected per deployment, not stored in the cron command.
create function private.invoke_deadline_sweep()
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'wtw_sweep_url';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'wtw_cron_secret';
  -- Fresh local databases and unconfigured deployments make no outbound calls.
  if nullif(btrim(v_url), '') is null or nullif(btrim(v_secret), '') is null then
    return null;
  end if;
  if v_url !~ '^https://[^/?#]+/functions/v1/api/internal/sweep$' then
    raise exception 'Invalid sweep endpoint configuration';
  end if;
  return net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
end;
$$;

revoke all on function private.invoke_deadline_sweep() from public, anon, authenticated, service_role;

select cron.schedule(
  'wtw-deadline-sweep',
  '* * * * *',
  'select private.invoke_deadline_sweep();'
);
