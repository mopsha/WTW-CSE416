import { isOpenAt, nextClosingTime, type OpeningHours } from '../domain/openingHours.ts';
import { isFresh } from './cache.ts';
import { withTimeout } from './timeout.ts';

export const HOURS_TTL_MS = 7 * 24 * 60 * 60_000;
export interface HoursRecord {
  placeId: string;
  provider: 'google' | 'mock';
  fetchedAt: string;
  openingHours: OpeningHours | null;
  timezone?: string;
  currentOpenNow?: boolean;
  currentClosesAt?: string;
}
/** Full hours caching is only allowed for our owned mock fixtures. */
export interface HoursCache {
  get(placeId: string): Promise<HoursRecord | null>;
  set(entry: HoursRecord & { provider: 'mock' }): Promise<void>;
}
export interface HoursProvider {
  fetchHours(placeId: string, options?: { signal?: AbortSignal }): Promise<HoursRecord>;
}
export interface HoursMetadata {
  placeId: string;
  openNow: boolean | null;
  closesAt: string | null;
  provider: 'google' | 'mock';
  fetchedAt: string | null;
  status: 'fresh' | 'refreshed' | 'unavailable';
}
export interface RefreshDependencies {
  provider: HoursProvider;
  mode: 'google' | 'mock';
  cache?: HoursCache;
  now?: () => Date;
}

function metadata(entry: HoursRecord, date: Date, status: HoursMetadata['status']): HoursMetadata {
  let openNow = isOpenAt(entry.openingHours, date, entry.timezone ?? '');
  if (entry.openingHours?.closed) openNow = false;
  let closesAt =
    nextClosingTime(entry.openingHours, date, entry.timezone ?? '')?.toISOString() ?? null;
  // Current provider observation includes special-day exceptions, but is not reusable as a weekly fact.
  if (
    !entry.openingHours?.closed &&
    typeof entry.currentOpenNow === 'boolean' &&
    isFresh(entry.fetchedAt, date, 60_000)
  ) {
    openNow = entry.currentOpenNow;
    const close = Date.parse(entry.currentClosesAt ?? '');
    closesAt = openNow && close > date.getTime() ? new Date(close).toISOString() : null;
  }
  return {
    placeId: entry.placeId,
    provider: entry.provider,
    fetchedAt: entry.fetchedAt,
    openNow,
    closesAt,
    status,
  };
}

/** Bound helper has the requested refreshOpenHours(placeIds) call shape. No Pick/ranking writes. */
export function createHoursRefresher(deps: RefreshDependencies) {
  return (placeIds: readonly string[]) => refreshOpenHours(placeIds, deps);
}
export async function refreshOpenHours(
  placeIds: readonly string[],
  deps: RefreshDependencies,
): Promise<HoursMetadata[]> {
  const results: HoursMetadata[] = [];
  for (const placeId of new Set(placeIds)) {
    const date = deps.now?.() ?? new Date();
    let cached: HoursRecord | null = null;
    // Never reuse Google hours from durable storage, even if an old adapter supplies them.
    if (deps.mode === 'mock') {
      try {
        cached = (await deps.cache?.get(placeId)) ?? null;
      } catch {
        /* Fetch instead. */
      }
    }
    if (
      cached?.provider === deps.mode &&
      cached.placeId === placeId &&
      isFresh(cached.fetchedAt, date, HOURS_TTL_MS)
    ) {
      results.push(metadata(cached, date, 'fresh'));
      continue;
    }
    try {
      if (!placeId.trim() || placeId.length > 256) throw new Error('Invalid place ID');
      const entry = await withTimeout((signal) => deps.provider.fetchHours(placeId, { signal }));
      if (
        entry.placeId !== placeId ||
        entry.provider !== deps.mode ||
        !isFresh(entry.fetchedAt, deps.now?.() ?? new Date(), HOURS_TTL_MS)
      )
        throw new Error('Invalid hours response');
      if (entry.provider === 'mock') {
        try {
          await deps.cache?.set({ ...entry, provider: 'mock' });
        } catch {
          /* Return fresh response even if cache is unavailable. */
        }
      }
      results.push(metadata(entry, deps.now?.() ?? new Date(), 'refreshed'));
    } catch {
      results.push({
        placeId,
        provider: deps.mode,
        fetchedAt: cached?.fetchedAt ?? null,
        openNow: null,
        closesAt: null,
        status: 'unavailable',
      });
    }
  }
  return results;
}

/** Add response metadata without mutating rank positions, candidates, or stored snapshots. */
export function enrichResults<T extends { placeId: string }>(
  rows: readonly T[],
  hours: readonly HoursMetadata[],
): (T & { openNow: boolean | null; closesAt: string | null })[] {
  const byId = new Map(hours.map((h) => [h.placeId, h]));
  return rows.map((row) => ({
    ...row,
    openNow: byId.get(row.placeId)?.openNow ?? null,
    closesAt: byId.get(row.placeId)?.closesAt ?? null,
  }));
}
