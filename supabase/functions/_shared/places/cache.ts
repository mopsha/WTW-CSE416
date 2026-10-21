import type { Candidate, PlaceSearch } from './types.ts';
import { validateSearch } from './GoogleProvider.ts';

export const SEARCH_TTL_MS = 5 * 60_000;
export function cacheKey(query: PlaceSearch): string {
  validateSearch(query);
  return `v1:${query.center.lat.toFixed(3)}:${query.center.lng.toFixed(3)}:${Math.ceil(query.radiusM / 250) * 250}:${query.category ?? 'all'}`;
}
/** Same bucket is only a lookup hint: reuse requires the exact original query. */
export function queryIdentity(q: PlaceSearch): string {
  return JSON.stringify([q.center.lat, q.center.lng, q.radiusM, q.category ?? null]);
}
export function isFresh(fetchedAt: string, now: Date, ttlMs: number): boolean {
  const age = now.getTime() - Date.parse(fetchedAt);
  return Number.isFinite(age) && age >= 0 && age < ttlMs;
}

interface CacheBase {
  key: string;
  query: string;
  fetchedAt: string;
}
export type SearchCacheEntry = CacheBase &
  ({ provider: 'google'; placeIds: string[] } | { provider: 'mock'; candidates: Candidate[] });
/** Future Supabase adapter must preserve this allowlist, not serialize arbitrary candidates. */
export interface PlaceCache {
  get(key: string): Promise<SearchCacheEntry | null>;
  set(entry: SearchCacheEntry): Promise<void>;
}
export function cacheEntry(
  key: string,
  query: string,
  candidates: Candidate[],
  provider: 'google' | 'mock',
  fetchedAt: string,
): SearchCacheEntry {
  if (provider === 'google')
    return { key, query, provider, fetchedAt, placeIds: candidates.map((p) => p.placeId) };
  if (candidates.some((p) => p.provider === 'google' || p.retention === 'request'))
    throw new Error('Restricted content cannot enter mock cache');
  return { key, query, provider, fetchedAt, candidates: structuredClone(candidates) };
}

export class MemoryPlaceCache implements PlaceCache {
  private readonly entries = new Map<string, SearchCacheEntry>();
  constructor(private readonly capacity = 100) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('Invalid cache capacity');
  }
  async get(key: string): Promise<SearchCacheEntry | null> {
    const entry = this.entries.get(key);
    return entry ? structuredClone(entry) : null;
  }
  async set(entry: SearchCacheEntry): Promise<void> {
    // Rebuild at the repository boundary: even runtime extra fields are stripped for Google.
    const safe: SearchCacheEntry =
      entry.provider === 'google'
        ? {
            key: entry.key,
            query: entry.query,
            fetchedAt: entry.fetchedAt,
            provider: 'google',
            placeIds: [...entry.placeIds],
          }
        : cacheEntry(entry.key, entry.query, entry.candidates, 'mock', entry.fetchedAt);
    this.entries.delete(entry.key);
    this.entries.set(entry.key, safe);
    while (this.entries.size > this.capacity)
      this.entries.delete(this.entries.keys().next().value!);
  }
}
