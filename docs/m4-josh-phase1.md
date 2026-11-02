# Josh M4 Phase 1 implementation and handoff

Branch: `josh/discover`. No commits or merges made by this task.

## Baseline audit (before edits)

Read `CLAUDE.md`, `AGENTS.md`, `docs/design.md`, `docs/places-phase1.md`,
`docs/api-integration.md`, and `docs/bugs.md` and inspected both API entry points,
provider/pool/cache code, lifecycle persistence, client/mock implementations and tests.
Local `main` and this branch pointed to the same commit at the start of the task.

Already present and retained:

- Discover's 36-place campus list, category/search filters, cards, details,
  directions, and Start a Pick navigation (`src/lib/discover.ts` and the tab).
- `useProfile`'s display-name context. This is not a preference-profile editor.
- Food provider fixtures on main. Every food row remains unchanged.
- Validated radius through create, database, pool and Google circle search.
- Pure opening-hours evaluator with timezone/DST tests.
- Google normalization, timeouts, category mapping, provider selector, mock fallback,
  bounded memory cache, Google ID-only cache policy, snapshot-retention guard.
- Existing swipe, ranking, voting, lifecycle state transitions and deadline sweep.

Missing: price/open filters, Activities mock selection, personalized Discover endpoint,
saved-place schema/routes, atomic quotas, and release protection for the demo public key.
Production lifecycle still constructed MockProvider directly. The preexisting
`places-phase1.md` explicitly records why blindly replacing it would persist
request-only Google content and conflict with canonical frozen ranking inputs.

## Requirement checklist

| Requirement                                                       | Status           | Evidence / limitation                                                                                                                                                                                                  |
| ----------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Radius throughout the real provider path                          | ALREADY COMPLETE | Existing validation, pool geometry and Google circle restriction; mock app now also applies radius.                                                                                                                    |
| `priceMax`, `openNow` end-to-end                                  | COMPLETE         | Controls in New Pick/Discover; shared validation; filtered create/load wrappers; pool and mock filtering before truncation.                                                                                            |
| Use `_shared/domain/openingHours.ts`                              | ALREADY COMPLETE | Reused `isOpenAt` for the new filter. Unknown hours/timezone are excluded when `openNow=true`.                                                                                                                         |
| Tuned Activities types                                            | COMPLETE         | Extended bounded Table A list for hiking, beaches, mini golf, performing arts, gardens and zoos.                                                                                                                       |
| Bug #11                                                           | COMPLETE         | Start, refresh and the existing friend Activities Pick use the activity fixtures. The provider fixture now includes the existing 16 Discover activities.                                                               |
| `GET /discover`, up to 20, personalized pure score, no pagination | COMPLETE         | Authenticated endpoint; `_shared/domain/discoverScore.ts`; UI consumes it while retaining local presentation for fixture IDs.                                                                                          |
| Cache-first owned/mock results                                    | COMPLETE         | Existing five-minute bounded memory cache; raw query results cached before request filters. Cache is per Edge isolate, not durable/shared.                                                                             |
| Cache-first Google content                                        | BLOCKED          | Existing project policy stores Google IDs only. IDs cannot serve a complete feed without fresh content; no Google content TTL/permission was invented.                                                                 |
| `0010_saved_places_limits.sql`, tables and RLS                    | COMPLETE         | Saved IDs only; private service-only counters; own-save SELECT policy; only API writes. No applied migration edited.                                                                                                   |
| POST/DELETE `/saved/:placeId`, GET `/saved`                       | COMPLETE         | Auth-derived owner, idempotent save/delete, stable list, client and mock methods, save button in existing details sheet.                                                                                               |
| Existing real Google provider                                     | ALREADY COMPLETE | Existing provider retained rather than reimplemented.                                                                                                                                                                  |
| Real Google in production Discover                                | COMPLETE         | API entry point injects configured builder; `PLACES_PROVIDER=google`, server-only `GOOGLE_PLACES_API_KEY`; all HTTP calls reserve against the daily counter.                                                           |
| Replace MockProvider in start/refresh with live Google            | BLOCKED          | Needs approved persistence/read contract for frozen candidate coordinates and display fields. Snapshot guard is now enforced at the lifecycle boundary; ranking/swipe/vote unchanged.                                  |
| Daily Google cap, atomic usage, fallback notice                   | COMPLETE         | Conditional UPSERT reserves before every Google HTTP attempt, including hours and failed requests. Provider fallback preserves safe mock data; response has `fallback` and `notice`, including empty fallback results. |
| POST `/picks`: 20/day                                             | COMPLETE         | Per authenticated user and database UTC day; denied request is HTTP 429.                                                                                                                                               |
| `/start`, `/refresh`: max 5 per Pick                              | COMPLETE         | Separate lifetime counters, five validated attempts per action per Pick; only host may consume. Invalid host/state/confirmation requests are checked first; HTTP 429 on exhaustion.                                    |
| Cap/rate/filter/feed/save tests                                   | COMPLETE         | Jest domain/client/provider coverage, Deno route coverage and SQL boundary/RLS tests. Local concurrent reservation experiment did not overshoot.                                                                       |
| Google key safety and EAS profiles                                | COMPLETE         | Demo lookup key and activation guarded by `__DEV__`; the public Google key stays out of EAS environments; Android release sentinel scan passed.                                                              |

## API and schema decisions

`GET /discover?lat=40.9126&lng=-73.1234&radiusM=5000&category=all`
accepts `category=all|food|activities`, optional integer `priceMax=0..4`, and
`openNow=true|false`. Radius is 200–50000 meters, default 5000. Coordinates are
required. No page token or continuation is returned. It returns
`{ places, fallback, notice }`, with at most 20 distinct places. `fallback=true`
means a fixture branch was used, including configured mock mode; the notice is
shown in the tab. Provider failure/cap beyond fixture coverage can return an empty
feed with a notice. Cache-Control is private/no-store for Discover and saved reads.

The pure score favors matching categories (+4), any matching provider type (+3),
known price within the profile budget (+2), then bounded rating (0–1) and proximity
(0–1); ties use the stable place ID. This is individual Discover scoring, entirely
separate from group Pick ranking. Preferences are read from the authenticated
caller's `profiles.discover_preferences` object: `{categories?: string[], types?:
string[], priceMax?: number}`. Missing/malformed optional fields use neutral defaults.
Scoring happens after query-cache retrieval, never inside a user-shared scored cache.

The new preference column is intentionally not included in authenticated profile
column grants: existing profile RLS also allows display-name reads by shared-Pick
participants. Granting the new column the same visibility would leak preferences.
Existing app queries select display columns explicitly. Teammates should avoid
`select('*')` on profiles and implement FR-02 updates through the API.

`GET /saved` returns `{places: [{placeId, createdAt}]}`. POST/DELETE return
`{status: 'ok'}`. Save IDs do not require `places` rows: a Google ID can be saved
without retaining provider content. This endpoint does not hydrate saved Google
IDs into display cards. Save is idempotent and preserves the original timestamp.

Filters are optional and default to no price/open constraint, preserving old
create callers. Existing `pick_create`/`pick_load` remain available; the API now
uses backward-compatible `pick_create_filtered`/`pick_load_filtered` wrappers.
Start/refresh still pass unchanged candidate snapshots to canonical RPCs. Empty
filtered pools return 409 without clearing answers. Unknown fixture prices/hours
are not represented as known-free/known-open: current fixtures have no authoritative
hours, so Open now normally produces an empty mock feed/deck.

Limits count **attempts**, after input/host/state/confirmation checks but before
provider/database work. A provider failure can consume an attempt; counters are
not refunded (avoids concurrent refund races and bounds retry spending).
Create buckets reset at database UTC midnight. Start/refresh do not reset daily.
Google quota counts HTTP attempts, not places; an all-category feed can consume
one food call and one activity call. Hours refresh shares this same budget.
Counter-storage failure prevents paid HTTP calls and uses existing provider
fallback/unknown-hours behavior; user-counter failure is 503, not a quota bypass.
Old counter cleanup is an operational retention task; it is not required for
correct date-scoped accounting.

## Deployment and teammate dependencies

Apply migration 0010 before deploying the new API. Numbers 0008/0009 do not exist
in this checkout; 0010 was requested explicitly, with no prerequisite on those
numbers. Coordinate reservation of migration names with Razin. No hosted migration,
secret, Google request, EAS build, deployment or main merge was performed here.

Set server secrets `PLACES_PROVIDER=google`, `GOOGLE_PLACES_API_KEY`, and optional
`GOOGLE_DAILY_CALL_CAP` (default 100; zero disables paid HTTP). Invalid cap values
fail closed. Mock mode remains the existing explicit/default provider setting.
No service key belongs in Expo public configuration.

- **Alan/Razin:** agree approved Google candidate storage, frozen ranking-coordinate
  retention, display hydration and history/expiry behavior before live group Picks.
  The code does not change ranking or invent replacement coordinates.
- **Razin:** FR-02 preference editing/onboarding must populate the documented private
  preference shape (or coordinate its mapping). Until then users get neutral scores.
- **Project administrator:** deploy migration/function, configure restricted server
  key and budget, and verify a hosted request. Existing dev public keys may already
  have been distributed; delete them from EAS environments and rotate/restrict as needed.
- **Mike:** saved-ID API is ready for any later saved-list screen; this task adds save
  controls to the existing details sheet, without building an unrelated screen.

## Google key decision

Keep the existing direct photo/details demo enhancement for local development only.
Both the key expression and enabled flag are gated by `__DEV__`; release lookups
return null and leave the existing fixture photos/ratings in place. Live Discover
search uses the backend provider. Production photo galleries/details hydration is
not newly implemented. EAS rejects an empty `env` value, so profiles can't blank
`EXPO_PUBLIC_GOOGLE_PLACES_KEY`. Never set it in an EAS environment, including for internal
distribution builds.

This follows Expo's [environment variable guidance](https://docs.expo.dev/guides/environment-variables/):
public variables are substituted into client code and are not secrets. The
[EAS environment guidance](https://docs.expo.dev/eas/environment-variables/) does
not make a referenced public value confidential. SDK 57 documentation was checked
before editing mobile code. The added activity types were checked against Google's
[Table A types](https://developers.google.com/maps/documentation/places/web-service/place-types).

## Validation

- `npm run lint`: PASS.
- `npm run typecheck`: PASS.
- `npm test -- --runInBand`: PASS, 43 suites / 376 tests.
- Deno check of `supabase/functions/api/index.ts`: PASS.
- Deno test of `supabase/functions/api/app_test.ts`: PASS, 23 tests.
- Clean local Postgres replay (0001–0006, 0010): PASS.
- `supabase/tests/saved_places_limits_test.sql`: PASS, 9 checks.
- Concurrent local Postgres experiment: 40 simultaneous requests for each scope;
  exactly 7 Google calls (cap 7), 20 creates, 5 starts and 5 refreshes admitted.
- Android release export: PASS. Export with
  `EXPO_PUBLIC_GOOGLE_PLACES_KEY=WTW_RELEASE_KEY_SENTINEL_20261028`; scanning every
  exported file, including Hermes bytecode, found no sentinel.
- `git diff --check`: PASS.

Deno was initially unavailable, so a temporary npm-cached Deno runner was used;
no project dependency or lockfile was changed. The temporary Postgres server was
stopped after verification. No live Google billing calls were made.
SQL checks were run on isolated local Postgres with minimal Supabase auth/role
bootstrap and migrations 0001–0006 plus 0010. pg_cron/pg_net/Vault migration 0007
was not applied in that temporary database; it is unrelated to the new tables/RPCs.
This is not a claim of a full Supabase/Docker reset (Docker is unavailable).

## File inventory

All 42 changed/new repository files:

- `app/(tabs)/discover.tsx`
- `app/pick/new.tsx`
- `docs/bugs.md`
- `docs/m4-josh-phase1.md`
- `docs/places-phase1.md`
- `eas.json`
- `src/components/PlaceFilterControls.tsx`
- `src/lib/api.ts`
- `src/lib/discover.ts`
- `src/lib/discoverFeed.ts`
- `src/lib/googlePlaces.ts`
- `src/lib/mock/api.ts`
- `src/lib/mock/placePool.ts`
- `src/lib/mock/store.ts`
- `src/lib/types.ts`
- `supabase/functions/_shared/api/discover.ts`
- `supabase/functions/_shared/api/errors.ts`
- `supabase/functions/_shared/api/lifecycle.ts`
- `supabase/functions/_shared/domain/createPick.ts`
- `supabase/functions/_shared/domain/discoverScore.ts`
- `supabase/functions/_shared/domain/placeFilters.ts`
- `supabase/functions/_shared/places/budget.ts`
- `supabase/functions/_shared/places/categoryMap.ts`
- `supabase/functions/_shared/places/pool.ts`
- `supabase/functions/api/app.ts`
- `supabase/functions/api/app_test.ts`
- `supabase/functions/api/discoverStore.ts`
- `supabase/functions/api/hours.ts`
- `supabase/functions/api/index.ts`
- `supabase/functions/api/lifecycleStore.ts`
- `supabase/functions/api/limits.ts`
- `supabase/functions/api/places.ts`
- `supabase/migrations/0010_saved_places_limits.sql`
- `supabase/seed/places.json`
- `supabase/tests/saved_places_limits_test.sql`
- `tests/domain/discoverScore.test.ts`
- `tests/lib/googlePlaces.test.ts`
- `tests/lib/mockActivities.test.ts`
- `tests/lifecycle.test.ts`
- `tests/lifecycleStore.test.ts`
- `tests/places/MockProvider.test.ts`
- `tests/places/phase1.test.ts`
