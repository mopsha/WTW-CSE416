import { googleHttp } from './limits.ts';
import { createConfiguredPoolBuilder } from '../_shared/places/config.ts';
import { MemoryPlaceCache } from '../_shared/places/cache.ts';

/** Request-scoped Google content for Discover; never passed to snapshot persistence. */
export const placesPoolBuilder = createConfiguredPoolBuilder((name) => Deno.env.get(name), {
  cache: new MemoryPlaceCache(),
  http: googleHttp,
  log: (event) => console.warn(JSON.stringify({ service: 'places', event })),
});
