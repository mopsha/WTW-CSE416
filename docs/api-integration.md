# Backend integration and deployment contract (Josh)

Phase 1 Places services are available separately; existing HTTP response shapes
remain unchanged. See [Places integration instructions](places-phase1.md) for
Alan's pool interface, hours response enrichment, provider configuration and the
Google snapshot-retention blocker before enabling real provider persistence.

Status: **IMPLEMENTED** lifecycle/closing, sweep, read-time hours and CD workflow.
**CI VERIFIED:** PR validation and local database/API jobs pass, including the hours
integration; the deploy job correctly skips on PRs. **HOSTED VERIFIED:** hosted CD,
cron delivery and real backend Google requests are not yet verified. **BLOCKED/PLANNED:**
Google lifecycle persistence/wiring and Realtime. Heartbeat RPCs are in `0002`,
lifecycle in `0003`, canonical closing/voting in `0004`, and cron scheduling in `0005`.

## HTTP contract

Base URL: `<SUPABASE_URL>/functions/v1/api`.

- `GET /health`: public liveness only; `{ "status": "ok" }`. Does not check database readiness.
- `POST /picks/:id/swipes`: Bearer user access token; body `{ "placeId": "...", "value": 2 }`.
  Values: 0 No, 1 Maybe, 2 Yes. Returns `{ "status": "ok" }` after persistence.
- `POST /picks/:id/rank`: Bearer user access token; host must also be a participant.
  Returns `results: [{ placeId, rank }]` (ordered top three) and `decision`:
  `{ kind: "winner", winner: { placeId, rank } }` or
  `{ kind: "vote", finalists: [{ placeId, rank }] }` (includes ties beyond three).
  Scores and other scoring internals stay server-side.

Errors: `{ "error": { "code": "...", "message": "..." } }`.
400 invalid input, 401 invalid/missing token, 403 forbidden, 404 missing resource,
409 wrong state/concurrent change, 500 unexpected failure, 503 unconfigured backend.
Gateway errors before the function executes are controlled by Supabase.
To let the handler own authentication/error formatting and public health, `supabase/config.toml`
sets `[functions.api] verify_jwt = false`.
User mutation routes explicitly verify the caller through Supabase Auth.
The internal deadline sweep uses its own server-side secret, described below.

## Automatic deadline sweep (Josh, Week 3)

`POST /internal/sweep` (deployed path `/functions/v1/api/internal/sweep`) requires
`x-cron-secret` matching the Edge Function environment variable `CRON_SECRET`.
Missing/incorrect headers return 401; an unset/empty server secret returns 503.
It does not use user authentication. Keep `CRON_SECRET` server-only: never use an
`EXPO_PUBLIC_` variable or send it from the mobile app. Existing `verify_jwt = false`
lets this handler verify the secret itself; user routes retain their Auth checks.

Each invocation captures one cutoff time and queries IDs in pages of 100:

- `state = 'swiping' AND deadline_at <= cutoff` calls the existing
  `closePick(store, id, 'system', null)`.
- `state = 'final_vote' AND vote_deadline_at <= cutoff` calls the existing
  `closeVoteByDeadline(store, id)`.

Null/future deadlines are excluded. Alan's canonical functions recheck eligibility
and handle repeated calls/state races; the sweep does not rank, tally, choose winners,
or set deadlines. `deadline_at` is the swipe deadline; `vote_deadline_at` is the
separate final-vote deadline established when swiping closes.
Pagination uses the last ID rather than offsets so closing earlier rows does not
skip later rows. One Pick failure does not stop other Picks; a failed phase query
does not stop the other phase. Remaining eligible Picks are retried next minute.

Responses contain only `status` and per-phase `attempted`, `processed`, `failed`,
and `queryFailed` counts/flags. `processed` includes canonical safe no-ops and is
not a count of state changes. Success is HTTP 200 / `status: "ok"`; any per-Pick or
query failure returns HTTP 503 / `status: "partial_failure"` after attempting the
remaining work. IDs, ballots, credentials, and database error details are omitted.

### Cron and wtw-dev configuration

Migration `0005_deadline_sweep.sql` enables `pg_cron`, `pg_net`, and Supabase Vault,
adds partial deadline indexes, and schedules `wtw-deadline-sweep` every minute
(`* * * * *`). Its private, invoker-rights helper is revoked from app/service roles
and runs as the database owner that installs the migration. It reads Vault values
at execution time and uses `net.http_post`; no URL or secret is embedded in the
migration or cron command. This follows the
[Supabase scheduling/Vault pattern](https://supabase.com/docs/guides/functions/schedule-functions).

Required deployment setup, performed separately by a wtw-dev administrator:

1. Apply migrations through `0005` and deploy the updated `api` function, retaining
   `verify_jwt = false` and its existing server-side Supabase configuration.
2. Generate a strong random secret and set it as the Edge Function `CRON_SECRET`.
3. In Supabase Vault, create `wtw_cron_secret` with the same secret and
   `wtw_sweep_url` with the **actual** wtw-dev HTTPS endpoint, ending in
   `/functions/v1/api/internal/sweep`. Use the project Dashboard's Vault controls;
   do not commit values or paste credentials into logs.
4. Verify authenticated execution and inspect `cron.job_run_details` plus
   `net._http_response` for HTTP status/body. A successful cron SQL run only means
   the asynchronous request was queued, not that the sweep succeeded.

Until both Vault values are nonempty, the scheduled helper returns null and sends
no HTTP request, including in fresh local databases/CI. The endpoint URL must use
HTTPS and the exact deployed path. No service-role key is sent by cron. No GitHub
secret or CD change is required. Rotation requires updating both the Edge secret
and Vault value; mismatches fail closed. To pause, an administrator can run
`select cron.alter_job(job_id := (select jobid from cron.job where jobname =
'wtw-deadline-sweep'), active := false);`.

Focused Jest coverage: `npx jest --runInBand tests/sweep.test.ts tests/sweepStore.test.ts`.
Hono route tests extend the existing `api/app_test.ts`; run with Deno 2 using
`deno test --config supabase/functions/api/deno.json supabase/functions/api/app_test.ts`.
Mocks test orchestration and query arguments, not deployed HTTP, SQL locking,
Vault permissions, or real cron delivery; verify those in a configured Supabase environment.

## Database adapter (Razin + Josh)

`api/store.ts` uses only the server-side service-role client. Razin's migration
implements these operations against the committed schema. RPC execution is revoked
from PUBLIC, anon, and authenticated and granted only to service_role. Never accept direct mobile calls to these service-only operations.

1. `heartbeat_load_pick(p_pick_id, p_user_id)` returns null if absent, denies nonparticipants,
   otherwise returns one coherent JSON snapshot matching `PickSnapshot` in
   `_shared/api/heartbeat.ts`: id, hostId, state, center `{lat,lng}`, participantIds,
   candidates `[{placeId,lat,lng}]`, preferences `[{userId,placeId,value}]`, version.
   Candidate coordinates must come from the fixed Pick snapshots. Preferences must
   contain at most one value per participant/place, only for current participants.
   Use a single consistent database snapshot. `version` is an opaque string that changes
   on *every* ranking input change (including participants, candidates, preferences and state).
2. `heartbeat_upsert_swipe(p_pick_id, p_user_id, p_place_id, p_value)` locks the Pick,
   verifies membership, exact `swiping` state, candidate membership and 0/1/2 value,
   then upserts `preferences` on `(pick_id, place_id, user_id)` and advances the version
   in the same transaction. All other Pick writers must take the same lock/version discipline.
3. `heartbeat_save_ranking(p_pick_id, p_user_id, p_version, p_ranking)` locks the Pick,
   rechecks host + participant authorization, exact `swiping` state and matching version.
   Reject stale results with 409; no partial writes. In one transaction transition to
   `ranking`, replace this Pick's `ranking_results` with `p_ranking.rows`, then transition
   to `p_ranking.state`. For a clear winner set winner_place_id, decided_at, and
   decided_by = clear_winner. Otherwise clear winner metadata and enter final_vote.
   Rows contain place_id, rank, score, finalist; validate they match the fixed candidate pool.
   Roll back all changes on failure. Retrying after completion returns 409; client reloads.

RPCs raise SQLSTATE `PT400`, `PT403`, `PT404`, or `PT409` for expected errors.
Other database errors are masked as 500; missing RPCs (`PGRST202`) return 503.
Before enabling: test revoked direct writes/RPC access, foreign candidates, outsiders,
forged client user IDs, simultaneous rank/swipe, cancellation during ranking, retries,
and rollback on failed persistence with real Postgres.

`api/auth.ts` wraps Razin's shared `getUser` (`_shared/auth/getUser.ts`), which validates
the bearer token with Supabase Auth; no second auth system.
Alan's ranking/state/geo modules are reused unchanged. Mike's auth screens, seeded Pick
reader, swipe UI, API client and ranked result screen are in Mike's app (PR #2).

## Local HTTP/database tests (Phase 2)

Requirements: Node 22.13+ (22 LTS), Supabase CLI on PATH, and Docker with its daemon
running. Deno 2 is needed for the separate existing Edge unit/type checks. No hosted
project link, Google key, or GitHub/Supabase hosted secret is needed. The committed
`supabase/config.toml` already initializes this project; do not run `supabase init`.

From the repository root:

```sh
supabase start
supabase db reset --local
supabase test db
```

Reset destroys the local development database and reapplies migrations and seed.
The existing SQL suite runs its 39 assertions in a rolled-back transaction. It is
reused unchanged. In another terminal, start `supabase functions serve api`, then:

```sh
node tests/api/wait.mjs
npm run test:api
```

The integration runner reads `supabase status -o json` privately in memory and
rejects any API URL other than loopback on the configured port 54321. Never paste
status output into logs: it includes credentials. Tests create three disposable,
confirmed local Auth users and obtain genuine sessions through password sign-in;
this bypasses email delivery only for test fixtures and does not change application
OTP/auth configuration. Service-role access sets up isolated fixtures and checks
persistence; application actions use user bearer tokens through the served API.

Sequential HTTP scenarios cover health/auth rejection, outsider/non-host
isolation, swipe persistence/upsert and token-derived identity, invalid candidates,
canonical auto-close, post-close conflicts, and canonical final-vote deadline persistence.
Runtime-unique IDs avoid collisions; candidate data and expected outcomes are
deterministic. Fixtures are deleted in `finally`, including partial setup failures.
After interruption, reset locally before retrying. Stop the serving terminal and
run `supabase stop --no-backup` when finished. Do not run alongside a local reset.

Tests live under `tests/api/*.mjs`, use Node's built-in test runner/fetch, and add no
dependencies. Jest's existing TypeScript unit-test selection is unchanged. Responses
containing Auth credentials are never included in assertions or logs; failed HTTP
operations report only their label and status. Each request and the overall suite
have time limits; API readiness is bounded to approximately 100 seconds.

CI retains the existing validation job and adds one independent integration job:
Docker check → local Supabase start → reset → existing pgTAP → serve/readiness →
HTTP integration tests. Steps and the job have timeouts; failures propagate normally.
Cleanup runs even after failures. CLI startup/reset/function output is kept in private
temporary files, never uploaded or printed, then removed; failure diagnostics expose
container names/status only. The job uses Supabase setup-cli's current stable release
(`latest`); it needs no npm install because the HTTP tests use only Node built-ins.
CLI installation follows [Supabase setup-cli](https://github.com/supabase/setup-cli).

Lifecycle create/start/refresh/cancel/read and canonical close/vote routes are
present. The HTTP integration harness now verifies persisted auto-close after the
final swipe, post-close conflicts without mutation, and canonical tied `/close`
with a future vote deadline unchanged on retry. It is not exhaustive coverage of
every lifecycle route or a real cron delivery test. Join remains outside this
implemented route set. Unit/route tests supplement the database/API harness.

## Read-time opening hours

The existing authenticated `GET /picks/:id` adds `candidateHours` metadata for
`completed` and `final_vote` Picks. Membership is checked before provider access;
responses use `Cache-Control: private, no-store`. The existing frontend
`queries.getCandidates()` still reads the persisted candidate identity/display
snapshot, then obtains this metadata through GET Pick. It preserves candidate
order and fields, adding optional `openNow` and `closesAt`. Existing mock-app reads
remain unchanged. No screen layout or lifecycle decision changes are included.

The read uses `refreshOpenHours` through a provenance-aware adapter. Explicitly
Google-tagged candidates fetch current hours using the server-only
`GOOGLE_PLACES_API_KEY`; no Google hours are cached or written to the database.
Fresh explicitly mock-tagged snapshot hours are validated with the helper's
seven-day freshness rule. Stale, missing, untagged legacy/demo hours, provider
errors, and timeouts produce unknown hours, never an invented open/closed status.
The current fixtures have no authoritative hours source. Discovery mode changes
never relabel an existing candidate or send a mock ID to Google.

Hours failures do not replace candidates or alter winner, ranking, votes, snapshots,
or Pick state. Swiping/draft reads do not fetch hours. The client retains persisted
candidates if the optional metadata request fails. Google candidate creation and
full display hydration remain blocked on the separate persistence design; this
read path does not enable Google lifecycle discovery or authorize Google snapshots.

## Main to wtw-dev deployment

**IMPLEMENTED; not hosted-tested.** PR CI passes and the deployment job correctly
skips on pull requests. A successful hosted main deployment is still outstanding.

The implemented CI workflow is configured to deploy the backend only on a push to `refs/heads/main`,
after **both** `validate` and `integration` succeed. Pull requests never execute the
deployment job. It checks out the exact validated commit and uses the same
`supabase/setup-cli@v1` / `latest` CLI setup as local integration CI.

Configure the GitHub environment **wtw-dev** manually before enabling deployments:

| Name | GitHub environment setting | Purpose |
| --- | --- | --- |
| `SUPABASE_ACCESS_TOKEN` | Secret | Supabase CLI authorization with access to link/deploy wtw-dev |
| `SUPABASE_DB_PASSWORD` | Secret | wtw-dev database password |
| `SUPABASE_PROJECT_REF` | Variable | Actual hosted wtw-dev project reference |

Restrict that environment's deployment branches to main. Required-reviewer rules,
if enabled, introduce a manual approval gate; omit that gate for fully automatic
main deployments. Never use the local `config.toml` project ID as the hosted ref.
Confirm hosted migration history matches the repository before the first run.
These values are not configured by the workflow.

Deployments share a `wtw-dev-backend-deploy` concurrency group with
`cancel-in-progress: false`. Inside that lock, the job checks the current remote
main SHA and skips superseded revisions, including old reruns. This favors the
latest main revision over deploying every intermediate merge. A main update during
an active deployment does not interrupt it; the newer successful run deploys next.
If the newer revision fails CI, it is not deployed. The guard prevents a slow older
queued run from overwriting a newer deployed revision during normal forward main
history; avoid force-pushing main.

Commands execute in this order:

```sh
supabase link --project-ref "$SUPABASE_PROJECT_REF"
supabase db push --linked --yes
supabase functions deploy api --project-ref "$SUPABASE_PROJECT_REF"
```

Migrations precede the function because its code may require new schema/RPCs.
Only pending migrations are applied: no hosted reset, seed, automatic history
repair, or general project-config push runs. The function deployment reads the
existing `[functions.api] verify_jwt = false` configuration; application user-auth
and internal cron-secret checks remain responsible for route authorization.

Each failure stops subsequent deployment steps and fails the job. CLI output is
redirected to a restricted temporary log, never printed or uploaded, and removed
in an always-run cleanup step. Logs report only which stage failed. No shell tracing
or CLI debug mode is used; credentials are supplied through environment variables.
The deployment job has a 15-minute timeout.

If migrations succeed but function deployment fails, the database changes remain;
there is no cross-service transaction or automatic rollback. Keep migrations
backward compatible with the previous function. Fix the cause and rerun the failed
job if that commit is still main; otherwise deploy a corrective main commit after
CI passes. Recorded migrations are skipped on retry. For schema defects use a new
forward-fix migration; never edit applied migrations or reset hosted data. An
administrator must inspect hosted migration/function status when diagnosing a
failure; a green local test is not proof that a hosted deployment worked.

`CRON_SECRET` belongs in hosted Edge Function secrets. Vault entries
`wtw_cron_secret` and `wtw_sweep_url` are configured separately by the hosted project
administrator, as described above. CD does not create, rotate, or overwrite them.
Provider configuration is also outside this deployment workflow. Successful CD
establishes command completion, not end-to-end cron delivery or live provider health.
