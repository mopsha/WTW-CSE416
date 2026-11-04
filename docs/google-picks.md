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
- **Discover:** always the full set, as before.

## How places are shown

`GET /picks/:id` fills in the details on each read (`_shared/places/pickPlaces.ts`):

- It repeats the Pick's Nearby Search once per category and matches results by place ID. One call
  returns up to 20 places, which is far cheaper than a lookup per place.
- Up to 5 places missing from that search are looked up individually. Any others, and any lookup
  that fails, show as "Place details unavailable".
- Only the top three and the winner get photos, because each photo is billed separately.
- Swipe, results and winner screens show the required Google Maps and photo author credit, linking
  to their sources when Google provides them (`GoogleCredit`).

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
