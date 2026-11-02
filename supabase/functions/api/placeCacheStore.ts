import type { PlaceCache, SearchCacheEntry } from '../_shared/places/cache.ts';
import { cacheEntry } from '../_shared/places/cache.ts';
import type { CacheCleanupStore } from '../_shared/api/cacheCleanup.ts';
import { createServiceClient } from './serviceClient.ts';

/** Google entries store IDs only; never persist response content or coordinates. */
export function createPlaceCache(): PlaceCache {
  return {
    async get(key) {
      const { data, error } = await createServiceClient()
        .from('place_cache')
        .select('entry')
        .eq('key', key)
        .maybeSingle();
      if (error) throw new Error('Cache read failed');
      return (data?.entry as SearchCacheEntry) ?? null;
    },
    async set(entry) {
      const safe =
        entry.provider === 'google'
          ? {
              key: entry.key,
              query: entry.query,
              fetchedAt: entry.fetchedAt,
              provider: entry.provider,
              placeIds: entry.placeIds,
            }
          : cacheEntry(entry.key, entry.query, entry.candidates, 'mock', entry.fetchedAt);
      const { error } = await createServiceClient().from('place_cache').upsert({
        key: safe.key,
        entry: safe,
        fetched_at: safe.fetchedAt,
      });
      if (error) throw new Error('Cache write failed');
    },
  };
}
export function createCacheCleanupStore(): CacheCleanupStore {
  return {
    async deleteExpiredOnce(day, cutoff) {
      const { data, error } = await createServiceClient().rpc('cleanup_place_cache', {
        p_day: day,
        p_cutoff: cutoff,
      });
      if (error) throw new Error('Cache cleanup failed');
      return data as { removed: number; ran: boolean };
    },
  };
}
