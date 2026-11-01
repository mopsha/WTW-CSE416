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

- `POST /picks` (**proposed by Mike, Alan to confirm/implement**): Bearer user access token; body
  `{ "category": "food" | "activities", "center": { "lat", "lng" }, "radiusM": 3219, "poolSize": 20,
  "deadlineAt": "<ISO 8601>" | null, "closeThreshold": 100 }`.
  Validate with `validateCreatePick` from `_shared/domain/createPick.ts` (same limits as the
  `picks` table checks; pool size 5–30; deadline 5 min – 7 days ahead) and return
  400 `INVALID_INPUT` on any problem. Creates a `draft` Pick with the caller as host and first
  participant, fills `pick_candidates` with up to `poolSize` places from the provider, and
  returns 201 `{ "pickId": "...", "state": "draft" }`. The app's mock (`src/lib/mock/api.ts`)
  implements exactly this.

- `GET /picks/:id/progress` (**Mike, Week 3**): Bearer user access token; participants only
  (403 `FORBIDDEN` otherwise, 404 `PICK_NOT_FOUND`). Counts only, never answers or ballots:
  `{ state, deadlineAt, doneCount, votedCount, total, participants: [{ userId, displayName,
  isHost, isMe, done, voted }] }`. `done` = answered every candidate. Host first, then by join
  time. The app polls this every 5 s when Realtime is down (`src/hooks/usePickLive.ts`).
  Implemented in `_shared/api/progress.ts` + `api/progressStore.ts` (service-role reads).

### Live updates (Mike)

The app subscribes to Supabase Realtime `postgres_changes` on `picks` (`id=eq.<pick>`) and
`pick_participants` (`pick_id=eq.<pick>`), and re-reads `GET /picks/:id/progress` on any event.
`0005_live_progress.sql` adds both tables to the `supabase_realtime` publication and a trigger on
`preferences` that sets `pick_participants.finished_at` when someone has answered every candidate
(and clears it if their answers are wiped by a refresh). Realtime applies the same SELECT RLS as
normal reads. `preferences`, `final_votes` and `ranking_results` are deliberately **not** published.
Test: `supabase/tests/live_progress_test.sql`.

### Pick routes the app calls

The app's typed client (`src/lib/api.ts`) and its mock (`src/lib/mock/api.ts`) follow these
exactly: `GET /picks/:id`, `POST /picks/:id/start`, `/refresh` (`{ confirm }`, 409
`CONFIRM_REQUIRED`), `/cancel` (Alan, PR #12); `POST /picks/:id/close`, `/vote` (`{ placeId }`),
`/close-vote` (Alan, PR #13). The lobby reads the join code from `pick_join_codes`
(`code, expires_at`, Razin; see below).

### Join by code (Razin)

- `POST /picks/join`: Bearer user access token; body `{ "code": "K7P2QX" }`. Case and spaces
  are ignored; anything that isn't 6 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` is
  400 `INVALID_INPUT` (checked before the database). Returns 200 `{ "pickId": "..." }`.
  404 `JOIN_CODE_NOT_FOUND` for an unknown or expired code; 409 `PICK_CLOSED` once the Pick is
  past `swiping` (`ranking`, `final_vote`, `completed`, `canceled`). Someone already in the Pick
  gets 200 with the same `pickId` and no second row, in any state.
  Code: `_shared/api/join.ts` (validation), `_shared/domain/joinCode.ts` (code rules, shared
  with the app), `api/joinStore.ts` (adapter). Client: `api.joinPick(code)`; the mock accepts
  `WTW234` for a friend's draft Pick.
- RPC `pick_join(p_code text, p_user_id uuid) returns uuid` (`0006_join_codes.sql`), service role
  only. Locks the Pick row; the participant insert advances `picks.version` (0002 trigger).
  PT404 unknown/expired code, PT409 Pick not joinable, PT403 caller has no profile.
- Codes: `pick_join_codes (code pk, pick_id, expires_at not null, created_at)`. A trigger on
  `picks` issues one for every new Pick (7-day expiry); 0006 backfilled draft/swiping Picks.
  Participants read them through RLS (`queries.getJoinCode`: newest `expires_at` first).
- App: the Lobby's QR/share link is `wtw://join/CODE` → `app/join/[code].tsx` (outside the auth
  guard: signed out, it signs in first and then joins); the Picks tab has "Join with code".
  Both open `/pick/[id]`, which forwards a draft Pick to the Lobby.

### Friends (Mike, M3)

- All routes need a Bearer user access token; the caller is always the token's user.
  - `GET /friends` → `{ friends, incoming, outgoing }`, each `[{ userId, displayName, since }]`,
    newest first (`since` = accepted for friends, sent for requests). `Cache-Control: private, no-store`.
  - `POST /friends/requests` `{ "email": "..." }` → `{ userId, displayName, status }`. Exact
    email match (case and surrounding spaces ignored). 404 `USER_NOT_FOUND`, 400
    `CANNOT_FRIEND_SELF`, 400 `INVALID_INPUT`. If they already asked you, this accepts
    (`status: "accepted"`); asking again is idempotent.
  - `POST /friends/:userId/accept` → `{ status: "accepted" }`; 404 `REQUEST_NOT_FOUND` unless
    they sent you a request (accepting twice is fine).
  - `POST /friends/:userId/remove` → `{ status: "ok" }`: decline, cancel, or unfriend. Idempotent.
  - Code: `_shared/api/friends.ts` (validation, grouping), `api/friendsStore.ts` (adapter).
    Client: `api.listFriends/addFriend/acceptFriend/removeFriend`; the mock
    (`src/lib/mock/friends.ts`) starts with Ava, Ben, Cam as friends and a request from Jordan.
- `0008_friendships.sql`: `friendships (requester_id, addressee_id, status pending|accepted,
  created_at, accepted_at)`, one row per pair either way, no self rows. RLS: the two people in a
  row can SELECT it, and can read each other's `profiles.display_name`. No client writes.
  RPCs (service role only): `friend_request`, `friend_accept`, `friend_remove`, `friend_list`;
  PT404 / PT400 / PT403 as above. Emails stay in `auth.users` and are never returned.
- Privacy trade-off: a 404 tells the caller whether an email has an account. There's no rate
  limit yet.

### My display name (Razin's Week 2 task)

- `POST /me`: Bearer user access token; body `{ "displayName": "Ava" }`. Trimmed, then 1–50
  characters counted like Postgres `char_length` (an emoji is one), one line (no control
  characters); otherwise 400 `INVALID_INPUT`, checked before the database. Returns 200
  `{ "displayName": "Ava" }`. It always writes the verified caller's own `profiles` row; any
  other field in the body (e.g. a `userId`) is ignored. POST, like every other mutation, so
  CORS stays `GET, POST`.
  Code: `_shared/api/profile.ts` (`validateDisplayName`, shared with the app and the mock),
  `api/profileStore.ts` (service-role upsert of `display_name` + `updated_at`, so an account
  without a profile row still gets one). No migration: `profiles` and its 1–50 check are in
  `0001_init.sql`, and clients still only read it through RLS (own row + co-participants).
- App: `ProfileProvider` (`src/hooks/useProfile.tsx`) reads my row with
  `queries.getMyProfile`. While `display_name` is null the root layout's guard shows
  `app/welcome.tsx` ("What should we call you?", prefilled from the email's local part)
  instead of the tabs; Save calls `api.updateMe(name)` and the guard moves on. If the read fails
  or times out (4 s) the step is skipped rather than blocking the app. The Profile tab shows
  and edits the same name. Mock mode starts with no name, so the step shows there too.
- Names show wherever `GET /picks/:id/progress` is used (Lobby, Waiting room, votes); a
  participant without a name is still shown as "Someone".
- `scripts/wtw-dev-code.mjs` (PR #21) can still set names server-side on wtw-dev, e.g. for
  seeded demo accounts; the app's step only appears for accounts that still have no name.

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
responses use `Cache-Control: private, no-store`. The frontend uses `api.getPick()`
to read candidates and hours together. Its adapter preserves candidate order and
fields, merging matching `candidateHours` metadata into `openNow` and `closesAt`.

The read uses `refreshOpenHours` through a provenance-aware adapter. Explicitly
Google-tagged candidates fetch current hours using the server-only
`GOOGLE_PLACES_API_KEY`; no Google hours are cached or written to the database.
Fresh explicitly mock-tagged snapshot hours are validated with the helper's
seven-day freshness rule. Stale, missing, untagged legacy/demo hours, provider
errors, and timeouts produce unknown hours, never an invented open/closed status.
The current fixtures have no authoritative hours source. Discovery mode changes
never relabel an existing candidate or send a mock ID to Google.

Hours failures do not replace candidates or alter winner, ranking, votes, snapshots,
or Pick state. Swiping/draft reads do not fetch hours. The Pick response retains
candidates when optional hours metadata is unavailable. Google candidate creation and
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
