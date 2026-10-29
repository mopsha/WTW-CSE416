import { SEARCH_TTL_MS } from '../places/cache.ts';

export interface CacheCleanupStore {
  /** Future durable adapter must atomically claim the UTC day and delete <= cutoff. */
  deleteExpiredOnce(day: string, cutoff: string): Promise<{ removed: number; ran: boolean }>;
}
export async function cleanupCache(store?: CacheCleanupStore, now = new Date()) {
  if (!store)
    return { status: 'blocked' as const, removed: 0, reason: 'PLACE_CACHE_NOT_AVAILABLE' };
  try {
    const result = await store.deleteExpiredOnce(
      now.toISOString().slice(0, 10),
      new Date(now.getTime() - SEARCH_TTL_MS).toISOString(),
    );
    return { status: 'ok' as const, ...result };
  } catch {
    return { status: 'partial_failure' as const, removed: 0, reason: 'CACHE_CLEANUP_FAILED' };
  }
}
