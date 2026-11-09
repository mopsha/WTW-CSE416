# PR #56 review response

The summary projection read only `snapshot.name`. Migration 0034 deliberately
stores null names for Google candidates, so production Google winners fell back
to category labels. Home focus cleanup also reset Picks/groups to null on every
blur, causing a loading screen on return.

The summary projection now carries the persisted winner ID and provider through
the existing composite winner FK. Home requests live names for only the displayed
completed Google winners (at most five). `POST /picks/recent-winners` authenticates,
validates the bound, and uses one participant-scoped database query for the exact
persisted winners. No client-supplied winner or viewer ID is trusted. Canceled,
missing and unauthorized Picks produce no winner display data. Non-Google and
custom names continue using stored snapshots. Ranking and tie-breaks are untouched.

The server reuses `GoogleProvider.pickPlace` from Pick results, including the same
atomic daily Google budget and bounded HTTP timeout. Repeated place IDs share one
lookup per request. There are no searches, photos, retries or polling. Missing
configuration, unavailable places, provider errors and quota failures return safe
fallbacks. The client checks the returned place ID against the summary's persisted
winner and uses `GoogleCredit` with Maps/source links beside each live name.
Google keys remain server-only. Responses are `private, no-store`; display data
lives only in screen state, is refreshed on focus and is never written to storage,
snapshots or summaries. See [Google's Places policies](https://developers.google.com/maps/documentation/places/web-service/policies).

Home retains loaded Picks and groups on blur and while refresh is pending. Refocus
loads fresh data; overlapping refreshes coalesce. Cleanup invalidates request
versions so stale results cannot replace newer state or initiate late lookups.
The account-keyed component discards all state on account changes; the auth guard
unmounts it on logout. Initial loading, errors, retry, empty states and routes remain.

Migration files 0038, 0039 and 0040 are unchanged. PR #54 must merge and deploy
0038 before PR #56 merges/deploys 0039 then 0040. No migrations were renamed and no
shared database or settings were changed.

Validation for this correction:

- Focused Jest covers live names/attribution, snapshot/custom names, fallbacks,
  wrong-winner rejection, five-row bounds, retained refresh data, account/logout
  isolation and stale responses. Adapter and client tests cover membership filters,
  the composite winner join and authenticated attribution conversion.
- Deno covers authenticated bounded batches, verified viewer identity, persisted
  winner IDs, provider failures/quota, absent rows and per-request deduplication.
  The new route suite is included in CI.
- Disposable PostgreSQL replay includes cached PR #54 migration 0038 in order,
  then 0039/0040, with Auth/Storage/cron stand-ins. Summary, performance, profile,
  username and birthday SQL suites pass. This is not a hosted Supabase test.
- Android and iOS Expo exports pass. Real Supabase API tests were attempted but
  cannot run here: the local stack and Docker are unavailable. No paid live Google
  API calls were made; Google responses/failures are injected in tests.

CI must run the real Supabase/PostgREST API regressions, including the new batch
route checks. Native QA remains: Google-backed history on iOS/Android, live Maps
and source links/attribution, offline/quota fallbacks, tab return without blanking,
rapid account changes and accessibility/font scaling. No commit, push, merge,
rebase or deployment was performed.

## Files changed

- UI: `app/(tabs)/index.tsx`.
- Client and query contract: `src/lib/api.ts`, `src/lib/queries.ts`,
  `src/lib/types.ts`, `supabase/functions/_shared/queries/pickSummaries.json`.
- Server: `supabase/functions/_shared/api/recentWinners.ts`,
  `supabase/functions/api/recentWinnersStore.ts`, `supabase/functions/api/app.ts`,
  `supabase/functions/api/index.ts`, `supabase/functions/api/places.ts`.
- Regressions: `supabase/functions/api/recentWinners_test.ts`,
  `tests/recentWinnersStore.test.ts`, `tests/components/PicksHome.test.tsx`,
  `tests/lib/api.test.ts`, `tests/lib/pickSummaryQuery.test.ts`,
  `tests/api/recent-history.test.mjs`.
- CI/docs: `.github/workflows/ci.yml`, `docs/recent-history-migrations.md`,
  `docs/recent-history-review-response.md`.

Final checks: TypeScript, ESLint, focused Jest (51 tests), full Jest (1,236 tests
across 155 suites), Deno check and all API-directory Deno tests (137), the five
SQL suites listed above, Android/iOS exports, JavaScript syntax check and
`git diff --check` pass. Real Supabase HTTP checks remain unavailable locally.
Ready for CI and reviewer assessment; merge still depends on PR #54's deployment
and successful real-stack CI/native QA.
