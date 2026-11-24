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
      // Every step runs and the first failure is reported at the end, so one failing step can't
      // keep the others (or the taste queue, last) from running this sweep.
      // The sweep already runs as service_role. Retain at least 24 hours of
      // message quota events (longest window: one hour), leaving daily safety
      // actions untouched. Run even when the daily cache claim was already used,
      // so a failed deletion can retry on the next sweep without a new RPC/schema.
      const eventCutoff = new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString();
      const { error: eventError } = await createServiceClient()
        .from('rate_limit_events')
        .delete()
        .eq('action', 'message_send')
        .lt('created_at', eventCutoff);
      // Google allows 30 days. Runs on every sweep, so a failed run retries, well inside that.
      const { error: purgeError } = await createServiceClient().rpc('purge_google_coordinates', {
        p_cutoff: new Date(Date.parse(`${day}T00:00:00Z`) - 27 * 86_400_000).toISOString(),
      });
      // Old password-login attempt counters (0057): buckets are 15 minutes, kept for a day.
      const { error: loginError } = await createServiceClient().rpc('purge_login_limits');
      // Signals learned from Google places' types are kept 30 days at most (0056).
      const { error: tasteError } = await createServiceClient().rpc('purge_google_taste', {
        p_cutoff: new Date(Date.parse(`${day}T00:00:00Z`) - 27 * 86_400_000).toISOString(),
      });
      if (error) throw new Error('Cache cleanup failed');
      if (eventError) throw new Error('Rate limit event cleanup failed');
      if (purgeError) throw new Error('Google coordinate cleanup failed');
      if (tasteError) throw new Error('Google taste cleanup failed');
      if (loginError) throw new Error('Login limit cleanup failed');
      return data as { removed: number; ran: boolean };
    },
  };
}
