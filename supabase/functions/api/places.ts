import { googleHttp } from './limits.ts';
import { createConfiguredPoolBuilder } from '../_shared/places/config.ts';
import { createPlaceCache } from './placeCacheStore.ts';

/** Request-scoped Google content for Discover; never passed to snapshot persistence. */
export const placesPoolBuilder = createConfiguredPoolBuilder((name) => Deno.env.get(name), {
  cache: createPlaceCache(),
  http: googleHttp,
  log: (event) => console.warn(JSON.stringify({ service: 'places', event })),
});
