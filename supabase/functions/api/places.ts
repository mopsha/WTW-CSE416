import { createConfiguredPoolBuilder } from '../_shared/places/config.ts';
import { MemoryPlaceCache } from '../_shared/places/cache.ts';

/** Ready for lifecycle dependency injection after its PR merges. No new public route. */
export const placesPoolBuilder = createConfiguredPoolBuilder((name) => Deno.env.get(name), {
  cache: new MemoryPlaceCache(),
  log: (event) => console.warn(JSON.stringify({ service: 'places', event })),
});
