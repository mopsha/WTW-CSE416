# Heartbeat integration contract (Josh)

Status: API and database contracts are implemented. The RPCs are in
`supabase/migrations/0002_heartbeat_rpcs.sql` (Razin); schema/RLS, SQL seed,
Supabase config and shared authentication are present. Real database and hosted
verification must pass before calling the integration end-to-end verified.

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

The app's typed client (`src/lib/api.ts`) and its mock (`src/lib/mock/api.ts`) follow Alan's
routes exactly (merged in #12 and #13): `GET /picks/:id`, `POST /picks/:id/start`, `/refresh`
(`{ confirm }`, 409 `CONFIRM_REQUIRED`), `/cancel`, `/close`, `/vote` (`{ placeId }`),
`/close-vote`. The Lobby reads the join code from `pick_join_codes` (`code, expires_at`, Razin's
#17) and shows a placeholder until that table exists.

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

Errors: `{ "error": { "code": "...", "message": "..." } }`.
400 invalid input, 401 invalid/missing token, 403 forbidden, 404 missing resource,
409 wrong state/concurrent change, 500 unexpected failure, 503 unconfigured backend.
Gateway errors before the function executes are controlled by Supabase.
To let the handler own authentication/error formatting and public health, `supabase/config.toml`
sets `[functions.api] verify_jwt = false`.
Every mutation route explicitly verifies the caller through Supabase Auth.

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
