# Places Phase 1 — Josh

Implemented on `josh/sweep-ci`; no deployment, hosted migration, or live Google call
has been performed. This is an offline-tested service layer. Main still has only
heartbeat routes. No UI, auth, ranking, closing, voting, or join logic was changed.

## Contracts and integration

Inspected `origin/alan/lifecycle` (`1d31941`) and `origin/alan/close-vote`
(`cdc7ccf`) without merging. Both use:

- `PlaceProvider.search({ center, radiusM, category? }): Promise<Candidate[]>`.
  The optional second `{ signal }` argument is backward compatible.
- `PoolBuilder.buildPool({ center, radiusM, category, poolSize }): Promise<Candidate[]>`.
- Candidate's existing required fields remain `placeId`, `name`, `category`, `lat`, `lng`.
  Additional fields are optional. Google metadata has `provider: 'google'` and
  `retention: 'request'`; owned fixtures have `provider: 'mock'`.

`pool.ts` implements this interface without importing lifecycle code. It filters
category/radius, sorts by ascending distance then descending rating then stable ID,
deduplicates IDs and caps the result. Duplicate representations use a deterministic
JSON tie-break. Missing ratings sort last at the same distance. Empty/unusable
results try the configured mock fallback, then throw `NoCandidatesError` with code
`NO_USABLE_CANDIDATES`. Callers must map this to their existing 409/API envelope.
Mock fixtures are geographically limited: fallback outside their radius can fail.
A request for 30 candidates can legitimately return fewer: Google's Nearby Search
limit is 20 and this implementation does not fabricate or silently mix extra mock
candidates into a successful Google response.

### After Alan's PR merges

1. Resolve the expected add/add conflict in `_shared/places/pool.ts`, keeping this
   implementation and Alan's structural interfaces. Run his pool/lifecycle tests
   and reconcile the deliberate no-candidates error behavior.
2. `api/places.ts` exports `placesPoolBuilder`. Replace Alan's module-level
   `createPoolBuilder(new MockProvider())` dependency in `api/index.ts` with it.
   Start with mock mode. The existing main entry point does not import this module;
   adding it now would have no discovery route to serve.
3. **Before enabling Google in lifecycle**, use `candidateSnapshot` at the
   `_shared/api/lifecycle.ts` buildCandidates boundary. It copies owned data and
   rejects Google/request-only content. Alan's current `pick_start`/`pick_refresh`
   RPCs write the entire candidate to `places.raw` and `pick_candidates.snapshot`.
   Those must not receive Google payloads as-is. Agree an ID-only provider reference,
   permitted coordinate handling/expiry, display-time hydration, and history design
   with Alan/Razin. This conflicts with today's NOT NULL name/snapshot contract.
   Do not erase existing snapshots or change ranking inputs during hours refresh.
4. At the HTTP response orchestration layer, create a bound
   `createHoursRefresher({ provider, mode, cache?, now? })`, supplying a provider
   matching each candidate's stored provenance. Deduplicate finalist/winner IDs.
   GoogleProvider implements `fetchHours`; mock hours can be supplied from owned
   fixtures (current MockProvider fixtures contain no hours, so return unknown).
5. After `rank()` resolves, enrich `results`, `decision.winner`, or
   `decision.finalists` using `enrichResults`. For Alan's `/close`, use its
   `winnerPlaceId` and finalist IDs and attach metadata separately. For GET Pick /
   persisted winner reads, refresh again at read time. Authorize membership before
   provider calls. Mike's current results screen reads Supabase directly, so agree
   an authenticated results-metadata read path and client adoption; changing only
   the immediate close response is insufficient. Never send internal scores.

`refreshOpenHours` returns metadata without writing Picks, snapshots or rankings.
Failures are isolated per ID, return `openNow: null`, `closesAt: null`, and do not
replace older cache data. The response preserves fetchedAt/status for diagnostics.
Missing hours never imply closed. Keep provider provenance internally and identify
mock/demo results clearly when a consumer UI is added.

## Google request and normalization

Nearby Search (New) uses POST, `includedTypes`, a circle restriction, DISTANCE rank,
and an explicit field mask (no wildcard). Categories use a bounded selection of
Table A types in `categoryMap.ts`. A transport and clock can be injected; tests use
only synthetic fixtures. Requests use a key header, never a key-bearing client URL.
Malformed required fields and known closed businesses are excluded; missing optional
rating/price/hours remain unknown. Photo names and author/provider attributions are
returned for request-time use, not cached. Actual photo retrieval/display is not
implemented. Display consumers must honor Google and author attribution rules.
Fields such as rating and hours incur the corresponding Google billing tier.

All provider calls have a three-second abortable timeout with listener/timer cleanup.
Pool construction also bounds injected providers that ignore abort. Failures use
fixed error/log codes, never keys, URLs, raw responses or caught error strings.
A Google exception, timeout, empty response, or response with no usable candidates
tries MockProvider. Bad provider configuration fails explicitly rather than silently
pretending Google mode is working. Cache/telemetry failures do not discard valid
provider results. Fallback data never populates the Google cache key.

## Storage policy and database migration decision

Official sources checked October 19, 2026:

- [Places policies](https://developers.google.com/maps/documentation/places/web-service/policies):
  place IDs are exempt from content-caching restrictions; attribution is required.
- [Service-specific terms, section 14](https://cloud.google.com/maps-platform/terms/maps-service-terms):
  the published non-EEA terms allow latitude/longitude caching up to 30 days.
  This is **not** a general 30-day permission for names, ratings, photos or hours.
- [Nearby Search](https://developers.google.com/maps/documentation/places/web-service/nearby-search),
  [Place resource](https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places),
  [Table A types](https://developers.google.com/maps/documentation/places/web-service/place-types).

The billing jurisdiction and any project-specific agreement remain unknown. Review
the applicable agreement before hosted use; EEA terms may differ. This implementation
chooses the conservative policy: **no Google content cache other than IDs**. Names,
addresses, coordinates, ratings, photo references, types, timezone and hours are
request-scoped. It does not use even the available 30-day coordinate allowance.

`PlaceCache` stores either owned mock candidates or Google place IDs plus our query
identity/provider/fetch timestamp. The implementation strips extra Google fields at
the repository boundary. `MemoryPlaceCache` has bounded capacity, returns copies,
and the pool checks TTL on every read. Keys include rounded coordinates (3 decimals),
a 250-meter radius bucket and category, with a provider namespace. Exact query
identity is also checked: a bucket hit must not silently reuse a different search
circle. Mock result TTL is five minutes, exclusive at the expiry boundary. Pool
size is not part of the key; cache stores all fetched candidates before capping.
Google ID entries are reference hints only; each Google search fetches current
content rather than treating IDs as a complete cached result.

Seven-day hours freshness applies to **owned mock data only**. At exactly seven days
an entry expires; future/invalid timestamps are stale. Google hours are always fetched
on demand and are neither read from nor written to durable hours storage. Thus the
seven-day requirement does not override provider restrictions. `HoursCache` is an
injected contract, not a deployed Supabase table.

No migration was created. Main has `0001`/`0002`; Alan owns unmerged `0003`/`0004`.
The unresolved Google snapshot/history contract prevents finalizing a useful
`place_cache` schema safely. The tested repository contracts are the Phase 1 seam.
After that agreement, allocate a new migration jointly; do not renumber applied
migrations. Proposed adapter constraints:

- Explicit provider/key/query/fetched-at columns, Google IDs only; no raw Google JSON.
- Mock payloads stored separately from Google IDs; validate provenance on write.
- Unique provider/key index and fetched-at index for cleanup.
- RLS enabled, no anon/authenticated reads or writes; explicit service-role grants.
- No dependency on unmerged schema until migration order is agreed.
- SQL tests for denied client access, allowed service access, and payload restrictions.

## Opening-hours semantics

`domain/openingHours.ts` is pure TypeScript. Weekly periods use local wall-clock
weekday (Sunday 0), hour and minute. Open boundaries are inclusive and close
boundaries exclusive; overnight/week-wrapping and overlapping periods work.
Empty periods means closed, absent/invalid data means unknown. Always-open and known
closed businesses are explicit. Invalid timezone/date yields unknown.

`nextClosingTime` finds the first UTC minute boundary that changes open to closed,
bounded to eight days. It uses the same IANA timezone conversion as `isOpenAt`, so
DST gaps and repeated hours follow wall-clock schedules rather than a fixed offset.
During a repeated-hour close, the first actual transition is used; an ambiguous
business's intended special DST policy is not invented. Weekly calculations cannot
predict holiday exceptions. The details provider's current observation takes priority
for one minute after fetch, including its next closing instant when supplied;
otherwise metadata is a regular-schedule calculation. Dated/truncated periods are
not normalized into recurring weekly schedules.

## Manual setup, switching and rollback (not executed)

1. Confirm the Google billing project/jurisdiction, enable Places API (New), set
   API restrictions, quotas and budget monitoring. Confirm pricing for the mask.
   Keep the server key only in backend secrets; never `EXPO_PUBLIC_*`.
2. Confirm the `wtw-dev` project reference and access owner. After lifecycle and
   persistence integration, set `GOOGLE_PLACES_API_KEY` through the authorized
   Supabase Edge Function Secrets dashboard. Do not paste it in logs, tickets or Git.
3. Set `PLACES_PROVIDER=mock` initially. Undefined defaults to mock; empty/unknown
   values are rejected. `EXPO_PUBLIC_USE_MOCK` is a separate whole-app simulation.
4. After persistence/attribution prerequisites are satisfied, set
   `PLACES_PROVIDER=google` using the same authorized dashboard. The selector reads
   mode/key on every build. [Supabase documents secrets changes without redeployment](https://supabase.com/docs/guides/functions/secrets).
   Verify this behavior on the actual project; no hosted behavior is claimed here.
5. Exercise a newly created Pick and confirm provenance, radius, hours and fallback.
   Roll back by setting `PLACES_PROVIDER=mock`, then test a new Pick again. Do not
   rewrite existing Pick pools. No public endpoint can change the mode.

No credentials are required by tests/CI. Deno checks, when available, should include
both `api/index.ts` and the not-yet-wired `api/places.ts` entry point. Run Jest,
lint/typecheck, Deno HTTP tests, then local database integration after the schema
work is agreed. Hosted credentials and migration permissions remain unverified.

## Verification in this workspace

- Restored existing lockfile dependencies with `npm ci --ignore-scripts`; no packages
  or lockfile versions were added/changed. The initial sandboxed install failed;
  retry with network access and a writable temporary npm cache succeeded.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test -- --runInBand`: 17 suites passed, 169 tests passed, zero failures.
- `CI=1 ./node_modules/.bin/expo export --platform android`: passed (bundle only,
  not a device/native build).
- `git diff --check`: passed.
- Deno/Supabase CLI absent: Deno checks and database integration were not run.
- No live Google/Supabase calls, secrets changes, branch changes, commits or deployment.

The audit's missing-package errors are resolved after restoring dependencies. An
initial new test-only TypeScript cast error was fixed; final checks above passed.
Local Node is 23.11.0, which produced dependency engine warnings; CI uses Node 22.
Use the documented supported Node version for CI/hosted reproducibility.
