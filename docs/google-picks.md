# Live Google places in Picks

Set `PICK_PLACES_PROVIDER=google` to build new Picks from Google instead of the Stony Brook
fixtures. Unset means fixtures. It's separate from Discover's `PLACES_PROVIDER`, so merging or
deploying never turns this on by itself. Existing Picks keep the provider they started with.

## What a Pick stores

Google's [service terms](https://cloud.google.com/maps-platform/terms/maps-service-terms) (section 14) and [policies](https://developers.google.com/maps/documentation/places/web-service/policies)
allow storing place IDs indefinitely and coordinates for up to 30 days. They don't allow storing
names, addresses, photos or ratings. So a Google candidate's snapshot is only:

`{ placeId, name: null, category, lat, lng, provider: 'google' }`

Ranking needs the coordinates to break ties. `purge_google_coordinates` removes them after 27 days,
and first cancels any Pick still open then, since it could no longer be ranked. **This runs from the
sweep, so check the sweep is healthy before turning Google on.** Otherwise coordinates stay past
Google's limit. If it fails, the sweep reports `partial_failure` and retries on its next run.

## Which fields are requested

Google bills a Nearby Search by the most expensive field requested, so `pickSearchMask` chooses:

- **Starting or refreshing a Pick:** the basic fields, unless it has a price or open-now filter.
  Those filters can't work without price and hours, so that one search uses the full set and bills at
  the Enterprise rate of about $0.035, after 1,000 free a month.
- **Showing a Pick:** always the basic fields.
- **Discover:** always the full set, as before. See "Discover filters" below for which search it uses.

## Discover filters

Discover searches around the device when location permission is already granted (it never asks;
onboarding and Create Pick do). Otherwise it uses Stony Brook. Coordinates are rounded to about
110 m before they're sent.

- **No price, rating or Open Now filter:** Nearby Search with the selected types, as before.
- **Any of those set:** Text Search (New) with `priceLevels`, `minRating` and `openNow`, so Google
  returns new places that match instead of us trimming the same popular 20. Text Search takes one
  `includedType` (used when exactly one type is selected) and only a rectangular
  `locationRestriction`, so the pool still trims results to the search circle.
- **Price is exact and food-only:** `prices=1,2` means $ or $$. Activities never send it, and For
  You applies it only to the food search. Older app builds that send `priceMax` keep the old
  "up to" meaning, for food only.
- **Open Now** is applied after the search. If no place is known to be open but some don't list
  hours, those are shown and the screen says their hours are unknown, rather than showing nothing.
- The response's `emptyBecause` names the filters that removed every place, for the empty state.

Each search is one call through the same `GOOGLE_DAILY_CALL_CAP` budget, with the same Discover
field mask, and it stores the same thing: place IDs only, under a cache key that includes every
filter. Text Search requests the same Enterprise-tier fields as the Discover Nearby Search, so
check its rate against real billing.

## How places are shown

`GET /picks/:id` fills in the details on each read (`_shared/places/pickPlaces.ts`):

- It repeats the Pick's Nearby Search once per category and matches results by place ID. One call
  returns up to 20 places, which is far cheaper than a lookup per place.
- Up to 5 places missing from that search are looked up individually. Any others, and any lookup
  that fails, show as "Place details unavailable".
- Only the top three and the winner get photos, because each photo is billed separately.
- Swipe, results and winner screens show the required Google Maps and photo author credit, linking
  to the place, the photographer and the photo's own page when Google provides them
  (`GoogleCredit`).

Drafts and canceled Picks skip all of this. Google places don't show ratings, prices or hours,
which Google bills at a higher tier. History lists the winner as "Winner" and Past Moves as a saved
place, since those lists would need a search for every row.

## Cost

Estimates from [list prices](https://developers.google.com/maps/billing-and-pricing/pricing), for 4
people and 20 places. Check these against real billing, because the field tiers and how often
places drop out of repeat searches haven't been measured.

- Each read is about $0.032 after 5,000 free searches a month.
- Each photo is $0.007 after 1,000 free a month.
- Each individual lookup is about $0.017 after 5,000 free a month.

`GOOGLE_DAILY_CALL_CAP` limits all Google calls, including Discover, and defaults to 100 a day. At
the cap, new Picks fall back to fixtures near Stony Brook, or fail elsewhere, and existing Picks
show unavailable places. 150 a day stays within the free searches if nothing else uses them. Also
set a budget alert in Google Cloud, since this cap counts calls, not dollars.

## Turning it on and off

1. Enable Places API (New), restrict the key to it, and add a budget alert.
2. Set `GOOGLE_PLACES_API_KEY` and `GOOGLE_DAILY_CALL_CAP` in Edge Function secrets.
3. Confirm the sweep runs and `purge_google_coordinates` succeeds.
4. Set `PICK_PLACES_PROVIDER=google` and try a new Pick away from Stony Brook.

To roll back, unset `PICK_PLACES_PROVIDER`. New Picks use fixtures again, and existing Google Picks
still need the key to show their places.
