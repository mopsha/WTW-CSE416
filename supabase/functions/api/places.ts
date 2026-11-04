import { googleHttp } from './limits.ts';
import { createConfiguredPoolBuilder } from '../_shared/places/config.ts';
import { GoogleProvider, PICK_SEARCH_MASK } from '../_shared/places/GoogleProvider.ts';
import { createPickPlaces } from '../_shared/places/pickPlaces.ts';
import { createPlaceCache } from './placeCacheStore.ts';

/** Request-scoped Google content; candidateSnapshot keeps only what a Pick may store. */
export const placesPoolBuilder = createConfiguredPoolBuilder((name) => Deno.env.get(name), {
  cache: createPlaceCache(),
  http: googleHttp,
  log: (event) => console.warn(JSON.stringify({ service: 'places', event })),
});

/** Each photo is one billable call against the same daily cap as searches. */
export const resolveDiscoverPhoto = (name: string) =>
  new GoogleProvider(Deno.env.get('GOOGLE_PLACES_API_KEY') ?? '', googleHttp).photoUrl(name);

const google = () => new GoogleProvider(Deno.env.get('GOOGLE_PLACES_API_KEY') ?? '', googleHttp);

/** Fills in a Pick's Google places on each read, against the same daily cap. */
export const pickPlaces = createPickPlaces({
  search: (query) => google().search(query, { mask: PICK_SEARCH_MASK }),
  details: (placeId, category) => google().pickPlace(placeId, category),
  photo: resolveDiscoverPhoto,
});
