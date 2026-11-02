# Josh M4 Phase 2 handoff

This is the original Phase 2 report. Current Hang integration is completed by
forward migration 0022; see docs/decisions.md and docs/api-integration.md. Earlier
BLOCKED dependency statements below describe that original checkout, not integ/m4.

Branch: `josh/custom-hang`, clean at the start, based on completed Phase 1.
No commit, main merge or hosted deployment was performed. No dependency was added.

## Dependency audit before edits

Read `CLAUDE.md`, `AGENTS.md`, Phase 1 handoff/places documentation, the architecture
and API contract in `docs/`, current migrations, provider/cache contracts, lifecycle
RPCs, mocks, client screens, and notification code. Expo SDK 57 docs were fetched
before mobile edits.

Available: Alan's `createPick`, canonical lifecycle/rank/swipe/vote helpers and SQL
RPCs, Razin's auth helper, Phase 1 saved IDs/Google provider/quotas, shared search
TTL, Mike's component/client infrastructure.

Absent: friendship/group/block tables or helpers, `_shared/domain/textFilter.ts`,
backend notification helper, atomic create-with-selected-participants helper,
`place_cache` table and durable cache adapter. `src/lib/notify.ts` is only a local
device demo notification utility. Existing `createPick` inserts the host participant;
it cannot create exactly two down responders when the host is not one of them.
No duplicate social, invitation, notification or moderation systems were invented.

## Requirement checklist

| Requirement                                       | Status           | Detail                                                                                                                                                                             |
| ------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preserve Phase 1 Discover/provider/filters/limits | ALREADY COMPLETE | Retained; no reimplementation or quota changes.                                                                                                                                    |
| POST `/picks` `includeSaved`                      | COMPLETE         | Validated, persisted, host-only resolution, inside-radius filtering, saved before provider/cache results, first-ID dedup, bounded pool; mock parity.                               |
| Include saved Google places                       | BLOCKED          | Saves contain IDs only; approved display/coordinate hydration and lifecycle retention remain unavailable from Phase 1. Owned fixtures and authorized persisted custom places work. |
| Sweep cleanup hook, TTL cutoff and count log      | COMPLETE         | Separate from canonical closes; UTC-day/atomic-delete adapter contract; tests at exact TTL boundary and secret-gated route.                                                        |
| Actual daily deletion of `place_cache` rows       | BLOCKED          | No table/schema/adapter exists. Sweep explicitly reports `PLACE_CACHE_NOT_AVAILABLE`; no deletion is claimed.                                                                      |
| Google quota/budget documentation                 | COMPLETE         | `docs/decisions.md`, with primary documentation references and distinction between request caps and billing alerts.                                                                |
| Migration `0015_custom_plans.sql`                 | COMPLETE         | Custom category, place/candidate source and creator columns, UUID IDs, input persistence/wrappers; original lifecycle RPCs untouched.                                              |
| Custom input validation                           | COMPLETE         | 2–20 options, names 1–60 after trim, notes 0–200, paired optional finite coordinates; SQL checks too.                                                                              |
| Razin text filter                                 | BLOCKED          | Optional helper absent; no substitute filtering implementation added. Custom Plans work with shape/length validation.                                                              |
| Same swipe/rank/final-vote engine                 | COMPLETE         | Unchanged algorithms/RPCs; custom options become normal snapshots. Four-option flow verified.                                                                                      |
| Optional nearby mixing                            | COMPLETE         | `mixCategory=food                                                                                                                                                                  | activities`, priority options followed by persistable provider results. |
| Optional live Google mixing                       | BLOCKED          | Existing request-only Google snapshots still rejected; no Phase 1 safeguard bypass.                                                                                                |
| Six one-tap templates                             | COMPLETE         | Game night, Basketball, Cookout, Study session, House party, Movie night. Each fills four editable options.                                                                        |
| Migration `0016_hang_posts.sql`                   | COMPLETE         | Tables, audience/status/expiry checks, one response/user/post, restrictive RLS. Group FK deferred because group table is absent.                                                   |
| POST `/hang`, own active list, compose card/sheet | COMPLETE         | Auth-derived author, validation, expiry, own-post API/RLS reads; group creation explicitly unavailable.                                                                            |
| Friends/group/block visibility and responses      | BLOCKED          | Graph helpers/schema absent. Shared reads are denied, response route returns 503; tests cover policy contracts with supplied graph evidence, not real social integration.          |
| POST `/hang/:id/pick`, exact down users           | BLOCKED          | Author gate implemented, missing canonical participant helper returns 503. No host-only Pick is created as a false substitute.                                                     |
| Backend notify integration                        | BLOCKED          | No helper exists; nobody is falsely notified through the local demo helper.                                                                                                        |
| Josh architecture diagram/description/stack       | COMPLETE         | Updated `docs/design.md`.                                                                                                                                                          |

## Behavior and contracts

POST `/picks` adds `includeSaved?: boolean`, `customOptions?: [{name,note?,lat?,lng?}]`
and `mixCategory?: 'food'|'activities'` for category `custom`. Other creation fields
remain unchanged. Pure custom requests default deck size to their option count;
with nearby mixing or includeSaved, the default is 20. Explicit deck size must fit
all typed options. Custom Picks permit 2–30 deck slots; ordinary categories still
require 5–30. Template selection fills editable options and never starts a Pick
without the existing Create/Lobby/Start flow.

Production IDs are assigned once by Postgres as `custom:<uuid>`; caller-supplied
identity/creator fields are not used. Start/refresh keep the same IDs and source/
creator metadata. The candidate and place provenance triggers extend existing RPC
writes; they do not replace lifecycle locking/authorization or ranking logic.

Pool order is typed options, then the host's saved resolvable places inside the
radius and satisfying price/open constraints, then provider results. The first
representation of each ID wins and the pool is capped. Mock saved food IDs are
mapped to the existing mock fixture identities, preventing duplicate venues without
renumbering the established demo decks. If priority options fill the deck, there
is no external provider call. A provider with no candidates does not erase a usable
saved/custom pool. Existing rate limits apply before building any deck.

Unlocated custom options have a marked neutral ranking point at the Pick center;
`locationProvided=false` ensures it is hidden as a display location. Directions
are suppressed for these options, notes display on swipe/details, and development
Google enhancement never searches for custom names. This preserves the numeric
ranking contract without presenting a fabricated venue address. See decisions.

`GET /hang` is an additional minimal UI read: own active posts only, with an
explicit sharing-unavailable notice. POST `/hang` accepts `{activity, startsAt,
expiresAt, audience, groupId}`; activity is 1–60 trimmed characters, start is within
seven days, expiry follows start by at most 24 hours. The compose sheet offers
starts in one hour, three hours or tomorrow. Production rejects group composition
until membership can be checked. Responses accept `down|maybe|cant`; the production
route returns `HANG_RELATIONSHIPS_UNAVAILABLE`. Author-only `/hang/:id/pick` returns
`HANG_PICK_HELPER_UNAVAILABLE`. No partial Pick or extra participant is created.

## Specific requested verifications

1. **Custom Pick with four typed options: PASS locally.**
   `tests/lib/customFlow.test.ts` sends the real client through the mock HTTP path:
   create → start → refresh (stable IDs) → four swipes → canonical ranking → final
   vote → completed winner. That mock uses the existing shared ranking functions.
   `supabase/tests/custom_plans_hang_test.sql` independently exercises actual
   canonical database start, heartbeat swipe, close and final-vote RPCs on four
   custom snapshots. The SQL supplies the valid tied ranking write; actual ranking
   computation is exercised by the client/shared-engine test, not reimplemented in SQL.
   No device or hosted end-to-end run is claimed.
2. **Hang post with two down responses creates exactly those people: BLOCKED.**
   Pure selection test returns exactly the two down IDs and excludes maybe/cant,
   without implicitly adding the author. Production creation is deliberately 503
   until Alan's atomic participant helper and Razin's graph authorization exist.
   A mocked selection test is not a claim that a real Pick was generated.

## Teammate handoff

- Razin: real accepted-friend, bidirectional-block and group access helpers; graph-
  backed RLS and atomic response authorization; group FK; optional textFilter.
- Alan: canonical atomic Pick creation/invites for exactly current down responders,
  including author/host semantics and idempotent repeated creation; backend notify.
- Places/schema owners: durable `place_cache` schema and adapter, atomic daily
  cleanup claim/delete, and the existing Google retention/hydration contract.
- Administrator: apply 0015 then 0016 after Phase 1 migrations before deploying this
  API. The explicitly requested migration numbers skip unprovided teammate files;
  coordinate reservations. No hosted migrations/secrets/builds were changed here.

## Validation

- `npm run lint`: PASS.
- `npm run typecheck`: PASS.
- `npm test -- --runInBand`: PASS, 47 suites / 400 tests.
- Deno check of `supabase/functions/api/index.ts`: PASS.
- Deno route tests in `supabase/functions/api/app_test.ts`: PASS, 26 tests.
- Clean replay of applicable migrations through 0016 in temporary Postgres: PASS.
- Phase 1 `saved_places_limits_test.sql`: PASS, 9 checks.
- Phase 2 `custom_plans_hang_test.sql`: PASS, 9 checks, including canonical four-
  option flow, source/creator metadata, hang expiry/uniqueness, and private saved-
  custom hydration authorization.
- Android release export: PASS. Scanning every exported file for the supplied
  `WTW_PHASE2_RELEASE_SENTINEL_20261028` test key found no occurrence.
- `git diff --check`: PASS.
- Verified no edits to canonical ranking, heartbeat/swipe, closing, voting logic,
  or `usePickRoute.ts`.

Deno used the existing temporary npm-cached runner from Phase 1. No project package
or lockfile changed. No hosted API/provider request or billing call was performed.
SQL uses an isolated temporary Postgres with minimal auth/role bootstrap, migrations
0001–0006, 0010, 0015 and 0016. The unrelated pg_cron/pg_net/Vault migration 0007 is
not run in this standalone database. Docker/Supabase-hosted end-to-end integration
is unavailable here. The development key guard is additionally checked with an
Android export sentinel scan.

## Every file changed

42 repository files (changes are uncommitted):

- `app/(tabs)/index.tsx`
- `app/pick/[id]/winner.tsx`
- `app/pick/new.tsx`
- `docs/decisions.md`
- `docs/design.md`
- `docs/m4-josh-phase2.md`
- `src/components/CustomPlanEditor.tsx`
- `src/components/HangCard.tsx`
- `src/components/PlaceCard.tsx`
- `src/components/PlaceDetailsSheet.tsx`
- `src/lib/api.ts`
- `src/lib/discoverFeed.ts`
- `src/lib/googlePlaces.ts`
- `src/lib/mock/api.ts`
- `src/lib/mock/hang.ts`
- `src/lib/mock/placePool.ts`
- `src/lib/mock/saved.ts`
- `src/lib/mock/store.ts`
- `src/lib/pickUi.ts`
- `src/lib/places.ts`
- `src/lib/types.ts`
- `supabase/functions/_shared/api/cacheCleanup.ts`
- `supabase/functions/_shared/api/hang.ts`
- `supabase/functions/_shared/api/lifecycle.ts`
- `supabase/functions/_shared/domain/candidatePriority.ts`
- `supabase/functions/_shared/domain/createPick.ts`
- `supabase/functions/_shared/domain/customPlans.ts`
- `supabase/functions/_shared/places/types.ts`
- `supabase/functions/api/app.ts`
- `supabase/functions/api/app_test.ts`
- `supabase/functions/api/hangStore.ts`
- `supabase/functions/api/index.ts`
- `supabase/functions/api/lifecycleStore.ts`
- `supabase/migrations/0015_custom_plans.sql`
- `supabase/migrations/0016_hang_posts.sql`
- `supabase/tests/custom_plans_hang_test.sql`
- `tests/cacheCleanup.test.ts`
- `tests/domain/customPlans.test.ts`
- `tests/hang.test.ts`
- `tests/lib/customFlow.test.ts`
- `tests/lifecycle.test.ts`
- `tests/lifecycleStore.test.ts`
