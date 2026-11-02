import { googleHttp } from './limits.ts';
import { createConfiguredPoolBuilder } from '../_shared/places/config.ts';
import { GoogleProvider } from '../_shared/places/GoogleProvider.ts';
import { createPlaceCache } from './placeCacheStore.ts';

/** Request-scoped Google content for Discover; never passed to snapshot persistence. */
export const placesPoolBuilder = createConfiguredPoolBuilder((name) => Deno.env.get(name), {
  cache: createPlaceCache(),
  http: googleHttp,
  log: (event) => console.warn(JSON.stringify({ service: 'places', event })),
});

/** Each photo is one billable call against the same daily cap as searches. */
export const resolveDiscoverPhoto = (name: string) =>
  new GoogleProvider(Deno.env.get('GOOGLE_PLACES_API_KEY') ?? '', googleHttp).photoUrl(name);
