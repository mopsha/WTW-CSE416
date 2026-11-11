import { googleHttp } from './limits.ts';
import { createConfiguredPoolBuilder } from '../_shared/places/config.ts';
import {
  GoogleProvider,
  PICK_SEARCH_MASK,
  pickSearchMask,
} from '../_shared/places/GoogleProvider.ts';
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

/**
 * Builds a Pick's deck. Its own switch, unset meaning mock, so Picks never turn Google on just
 * because Discover already uses it. Price and open-now filters need fields Google bills higher,
 * so a Pick only requests them when it uses those filters.
 */
export const pickPoolBuilder = createConfiguredPoolBuilder(
  (name) => Deno.env.get(name === 'PLACES_PROVIDER' ? 'PICK_PLACES_PROVIDER' : name),
  {
    cache: createPlaceCache(),
    http: googleHttp,
    log: (event) => console.warn(JSON.stringify({ service: 'places', event })),
    searchMask: pickSearchMask,
  },
);

const google = () => new GoogleProvider(Deno.env.get('GOOGLE_PLACES_API_KEY') ?? '', googleHttp);

/** Fills in a Pick's Google places on each read, against the same daily cap. */
export const pickPlaces = createPickPlaces({
  search: (query) => google().search(query, { mask: PICK_SEARCH_MASK }),
  details: (placeId, category) => google().pickPlace(placeId, category),
  photo: resolveDiscoverPhoto,
});

/** Same live details lookup and atomic Google budget as Pick results; no photos. */
export const winnerDetails = (
  placeId: string,
  category: import('../_shared/places/types.ts').Category,
) => google().pickPlace(placeId, category);
