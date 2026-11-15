# Discover Filters V2

Discover remains a fixed Stony Brook, authenticated, bounded feed. There is no
provider page token or load-more pagination: one nearby search per category (two
for For You), at most 20 Google candidates per search, and at most 20 final places.
Sorting describes this returned selection, not every business in the radius.
Local text search still searches only that feed and makes no provider requests.

## Controls and matching

One `DiscoverFilterSheet` owns a fresh draft each time it opens. Show places commits
all edits; Close/backdrop/Android back discards them. Reset resets shared controls
and the current tab's sections, preserving the other tab's selections. State is
memory-only and remounts at account boundaries. No request occurs while editing,
including slider movement; applying semantically unchanged parameters is a no-op.

- Every tab: maximum price (including known Free), minimum rating, radius and Open
  now. Unknown prices/hours do not satisfy an explicit constraint. Any rating keeps
  unrated places; a minimum excludes them.
- Food: cuisines and food types from the shared allowlist. OR within each section,
  AND between the two sections. Any clears only its own section.
- Activities: bowling, arcades, movies, mini golf, sports venues, shopping malls,
  museums, parks/hiking. OR within the section. Shopping is deliberately labelled
  **Shopping malls**, rather than claiming arbitrary shopping areas match.
- For You: only shared controls; saved Food/Activity selections are not sent.
- Recommended preserves the existing survey scoring. Nearest, Highest rated and
  Most reviewed sort the bounded candidates with stable place-ID tie breaks.
  Unknown ratings/counts sort last. Explicit filters/sorts disable the old
  photo-first promotion so it cannot override the requested ordering.

The default remains **5,000 meters**, displayed as **3.1 mi**; opening or applying
an unchanged sheet does not round it. Miles convert with 1 mi = 1609.344 m and round
to an integer meter for the API. Slider range is 1–25 mi, with 1/5/10/25 presets;
25 mi is 40,234 m, below the existing 50,000 m provider/API maximum. Distance is a
straight-line search radius, not driving distance.

## Provider and server behavior

`domain/discoverFilters.ts` defines the shared allowlist and matching rules.
`parseDiscover` validates `cuisines`, `foodTypes`, `activityTypes`, `minRating` and
`sort`, including category relevance, before the existing rate-limit/provider path.
The existing location, price, opening-hours and radius validation remains intact.

Google receives a single `includedTypes` OR list for a selected category, never a
request per selected chip. When both Food sections are selected, cuisines constrain
the Google search and food types are AND-matched on the server. Nearest requests
Google's DISTANCE ranking; other modes request POPULARITY and sort the returned set.
Minimum rating, price and opening hours are evaluated on the server before the
pool/final result limits. Strict combinations can therefore return a small or empty
selection even if other matching businesses exist nearby; the UI discloses this.

The Discover field mask adds `places.userRatingCount` to its existing rating,
price/hours fields. Those existing fields and userRatingCount use Google's Nearby
Search Enterprise tier; this adds no higher SKU tier. It adds no detail requests.
Existing optional first-photo resolution still spends up to one budgeted photo
request per returned place. All search/photo calls retain the shared atomic daily
budget, timeouts and fixture fallback behavior. Fallback notices remain explicit,
including when strict filters remove all fixtures. Genuine filtered emptiness is
shown separately from request failures.

Pick masks, category mappings, snapshots and candidate generation are unchanged.
Discover-only search types are an additive `discovery` constraint. Mock fixtures
use explicit mappings from existing curated fixture labels when category filters
are active; unknown classifications do not match. Ratings, review counts and free
prices are never invented. Existing unfiltered fixture recommendation behavior
remains unchanged.

## Identity, caching and privacy

Category selections are sorted before requests and validated/canonicalized by the
API. New constraints participate in search-cache key and exact-query identity.
Legacy raw candidate cache reuse remains safe because price/hours are applied after
cache reads. Google cache entries remain IDs and query inputs only; no new Google
response fields, reviews, names or photos are persisted. Credentials stay server-side.
Account and complete applied-query identity guard responses. Only a same-query
refresh can retain old results while pending; older filter/tab/account results
cannot populate the active feed. Existing Google attribution and saving stay intact.

## Deferred classifications and device QA

Escape rooms are deferred: no dedicated allowlisted Google Nearby type was found.
Indoor/Outdoor, dietary and halal controls are deferred: current types do not
reliably describe those properties. Broad amusement-center types must not stand in
for an escape-room classification.

Before release, test the sticky sheet footer, native slider/switch, large Dynamic
Type, narrow screens and VoiceOver/TalkBack on iOS/Android. Exercise real Google
responses with missing ratings/prices/hours/counts, combined filters, fallback/quota
notices, and native photo attribution. No new location collection is introduced.

Sources audited:
- https://developers.google.com/maps/documentation/places/web-service/place-types
- https://developers.google.com/maps/documentation/places/web-service/nearby-search
- https://docs.expo.dev/versions/v57.0.0/sdk/slider/
