# Places Phase 1 — Josh

## Current Week 4 status

- **IMPLEMENTED:** Google provider, timeout/fallback, cache contracts, runtime
  selector, hours helper and authenticated read-time hours integration.
- **CI VERIFIED:** PR validation and local database/API jobs pass, including the
  opening-hours changes. The main-only deployment job correctly skips on PRs.
- **HOSTED VERIFIED:** No real backend Google request, hosted CD execution, or
  cron delivery has been verified. An existing Google project/key and API enablement
  do not prove a request through this backend works.
- **BLOCKED/PLANNED:** Google lifecycle discovery, safe Google snapshot/ranking
  persistence, full display hydration, and durable Places cache integration.

Alan's lifecycle/closing implementation is present. The actual API entry point
still directly constructs MockProvider; it does not import `api/places.ts`'s
configured builder. Google env variables alone cannot change lifecycle discovery.
See the [real-versus-mock table](design.md#real-versus-mock).

## Contracts and integration

Current shared contracts:

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

### Current lifecycle boundary and remaining work

`api/places.ts` exports a configured `placesPoolBuilder`, but `api/index.ts` uses
`createPoolBuilder(new MockProvider())`. The active start/refresh routes therefore
bypass configured Google selection, fallback and injected cache. `MockProvider`
uses `supabase/seed/places.json`'s unapproved placeholders; `supabase/seed.sql`'s SBU
demo pool is a different source inserted directly into the database.

Do not simply replace the entry-point dependency. Lifecycle `buildCandidates`
currently wraps every full candidate as `{placeId, snapshot}`. The start/refresh
RPCs persist that snapshot in both `places.raw` and `pick_candidates.snapshot`.
`candidateSnapshot` in `pool.ts` rejects Google/request-only content but is not
called at this persistence boundary. Wiring it would block unsafe writes; it would
not by itself make Google candidates usable.

Closing reads frozen candidate coordinates and the Pick center to compute the
canonical distance tie-break. ID-only references plus display hydration do not
supply that stable input. A precomputed distance could preserve algorithmic behavior
with a coordinated input-contract change, but permission to retain a Google-derived
value has not been established. Calling it application metadata does not establish
an exemption. Coordinate the persistence/read contract with Alan/Razin and the
client data contract with Mike; keep ranking decisions and lifecycle transitions
canonical. Do not invent coordinates, relax safeguards, or edit applied migrations.

### Implemented opening-hours read path

The existing authenticated `GET /picks/:id` enriches completed/final-vote reads with
`candidateHours`, after membership checks. `api/hours.ts` binds
`createCandidateHours`, which calls `refreshOpenHours` by stored provenance.
`src/lib/queries.ts` retains snapshot identity/display data and attaches optional
`openNow`/`closesAt` from this endpoint. No second close/results decision engine is
introduced, and no screen-layout change is included.

Explicit Google provenance fetches hours on demand; nothing is persisted. Fresh
explicitly mock-tagged hours use the existing freshness/validation rules. Untagged
legacy/demo data, missing or stale fixture hours, and provider failures yield
unknown hours. Current fixtures have no authoritative hours source. Provider-mode
changes never relabel an existing Pick or send its mock IDs to Google. Failures
preserve candidate identity, ranks, winners and state. This read integration is
CI verified; it does not resolve Google candidate creation or full display hydration.

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

Previously recorded policy references (October 19, 2026; not newly verified by this documentation update):

- [Places policies](https://developers.google.com/maps/documentation/places/web-service/policies):
  place IDs are exempt from content-caching restrictions; attribution is required.
- [Service-specific terms, section 14](https://cloud.google.com/maps-platform/terms/maps-service-terms):
  the prior review recorded a non-EEA latitude/longitude caching allowance of up to 30 days; applicability to this project remains unverified.
  This is **not** a general 30-day permission for names, ratings, photos or hours.
- [Nearby Search](https://developers.google.com/maps/documentation/places/web-service/nearby-search),
  [Place resource](https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places),
  [Table A types](https://developers.google.com/maps/documentation/places/web-service/place-types).

The billing jurisdiction and any project-specific agreement remain unknown. Review
the applicable agreement before hosted use; EEA terms may differ. This implementation
chooses the conservative policy: **no Google content cache other than IDs**. Names,
addresses, coordinates, ratings, photo references, types, timezone and hours are
request-scoped. This request-only rule is our conservative design choice, not a claim that every field has the same external prohibition. Any coordinate or derived-distance retention proposal needs verification against the applicable current agreement.

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

No durable Places-cache migration or adapter exists. Lifecycle/voting migrations
`0003`/`0004` and deadline-sweep migration `0005` are present; they do not resolve
Google snapshot retention. Agree the permitted fields, stable ranking inputs,
expiry and history behavior before adding a new migration. Never renumber or edit
applied migrations. Proposed adapter constraints:

- Explicit provider/key/query/fetched-at columns, Google IDs only; no raw Google JSON.
- Mock payloads stored separately from Google IDs; validate provenance on write.
- Unique provider/key index and fetched-at index for cleanup.
- RLS enabled, no anon/authenticated reads or writes; explicit service-role grants.
- Coordinate schema/RPC changes with their owners and preserve existing mock data.
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

## Future hosted setup, switching and rollback (blocked prerequisites)

These steps apply only after the configured builder and safe persistence contract
are integrated. Today, changing `PLACES_PROVIDER` does not change lifecycle discovery.
API keys and secret values must never be committed, logged, or placed in frontend
configuration. This document records names and procedures only.

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

Provider unit tests use synthetic responses and require no Google credentials.
CI validates the API entry point and runs local database/API integration; the
configured Places builder is exercised through its unit tests, not live Google.
Hosted CD credentials are separate from provider runtime secrets; see
[deployment configuration](api-integration.md#main-to-wtw-dev-deployment).

## Verification and remaining acceptance work

PR validation and local database/API checks are green; PR deployment is correctly
skipped. Opening-hours integration is CI verified. No live Google request, hosted
CD execution or cron delivery is claimed. Remaining acceptance work includes:

- Resolve permitted candidate persistence and deterministic ranking inputs.
- Wire configured discovery and verify mock/Google switching in the real lifecycle.
- Verify live Google backend requests and failure/recovery without logging credentials.
- Confirm the intended mock fixture coverage and reconcile `NoCandidatesError`
  mapping at the lifecycle boundary (it currently falls through as a generic error).
- Verify hosted deployment, migration compatibility and cron configuration/delivery.
