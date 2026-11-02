import { matchesFilters, validFilters, type PlaceFilters } from '../domain/placeFilters.ts';
import { distanceMeters, type LatLng } from '../domain/geo.ts';
import type { Candidate, Category, PlaceProvider } from './types.ts';
import { validateSearch } from './GoogleProvider.ts';
import {
  cacheEntry,
  cacheKey,
  isFresh,
  queryIdentity,
  SEARCH_TTL_MS,
  type PlaceCache,
} from './cache.ts';
import { ProviderTimeoutError, withTimeout } from './timeout.ts';

/** Structurally identical to Alan's lifecycle branch. */
export interface PoolRequest extends PlaceFilters {
  center: LatLng;
  radiusM: number;
  category: Category;
  poolSize: number;
}
export interface PoolBuilder {
  buildPool(request: PoolRequest): Promise<Candidate[]>;
}
export type PlacesEvent =
  'provider_failed' | 'provider_timeout' | 'provider_empty' | 'cache_failed' | 'fallback_failed';
export interface PoolOptions {
  provider?: 'google' | 'mock';
  fallback?: PlaceProvider;
  cache?: PlaceCache;
  now?: () => Date;
  /** Only fixed event codes; never error objects, request URLs, or response bodies. */
  log?: (event: PlacesEvent) => void;
}
export class NoCandidatesError extends Error {
  readonly code = 'NO_USABLE_CANDIDATES';
  constructor(readonly fallbackAttempted = false) {
    super('No usable nearby places are available from the configured providers');
  }
}

function filterPool(found: Candidate[], request: PoolRequest): Candidate[] {
  const valid = found.filter(
    (p) =>
      p &&
      typeof p.placeId === 'string' &&
      p.placeId.trim() &&
      typeof p.name === 'string' &&
      p.name.trim() &&
      p.category === request.category &&
      Number.isFinite(p.lat) &&
      Math.abs(p.lat) <= 90 &&
      Number.isFinite(p.lng) &&
      Math.abs(p.lng) <= 180 &&
      distanceMeters(request.center, p) <= request.radiusM,
  );
  const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const rating = (p: Candidate) =>
    typeof p.rating === 'number' && Number.isFinite(p.rating) ? p.rating : -1;
  valid.sort(
    (a, b) =>
      distanceMeters(request.center, a) - distanceMeters(request.center, b) ||
      rating(b) - rating(a) ||
      compareText(a.placeId, b.placeId) ||
      compareText(JSON.stringify(a), JSON.stringify(b)),
  );
  const unique = new Map<string, Candidate>();
  for (const p of valid) if (!unique.has(p.placeId)) unique.set(p.placeId, p);
  return [...unique.values()];
}

export function createPoolBuilder(provider: PlaceProvider, options: PoolOptions = {}): PoolBuilder {
  const mode = options.provider ?? 'mock',
    now = options.now ?? (() => new Date());
  const log = (event: PlacesEvent) => {
    try {
      options.log?.(event);
    } catch {
      /* Telemetry is best effort. */
    }
  };
  return {
    async buildPool(request) {
      validateSearch(request);
      if (!validFilters(request)) throw new RangeError('Invalid place filters');
      if (!Number.isInteger(request.poolSize) || request.poolSize < 1 || request.poolSize > 30)
        throw new RangeError('poolSize must be 1..30');
      const key = `${mode}:${cacheKey(request)}`,
        query = queryIdentity(request);
      try {
        const cached = await options.cache?.get(key);
        if (
          mode === 'mock' &&
          cached?.provider === 'mock' &&
          cached.query === query &&
          isFresh(cached.fetchedAt, now(), SEARCH_TTL_MS)
        ) {
          const candidates = filterPool(cached.candidates, request);
          if (candidates.length)
            return structuredClone(
              candidates
                .filter((p) => matchesFilters(p, request, now()))
                .slice(0, request.poolSize),
            );
        }
      } catch {
        log('cache_failed');
      }
      let found: Candidate[] = [],
        source = mode;
      try {
        found = filterPool(
          await withTimeout((signal) => provider.search(request, { signal })),
          request,
        );
        if (!found.length) log('provider_empty');
      } catch (error) {
        log(error instanceof ProviderTimeoutError ? 'provider_timeout' : 'provider_failed');
      }
      if (!found.length && options.fallback) {
        source = 'mock';
        try {
          found = filterPool(
            await withTimeout((signal) => options.fallback!.search(request, { signal })),
            request,
          );
        } catch {
          log('fallback_failed');
        }
      }
      if (!found.length) throw new NoCandidatesError(!!options.fallback);
      const fetchedAt = now().toISOString();
      const candidates = found.map((p) => ({
        ...p,
        // A Google marker is never downgraded by an incorrectly configured caller.
        provider: p.provider === 'google' ? ('google' as const) : source,
        retention:
          p.provider === 'google' || source === 'google'
            ? ('request' as const)
            : ('persistable' as const),
        fetchedAt: p.fetchedAt ?? fetchedAt,
      }));
      try {
        // Never cache fallback under the Google key, so recovery is attempted next request.
        if (source === mode)
          await options.cache?.set(cacheEntry(key, query, candidates, source, fetchedAt));
      } catch {
        log('cache_failed');
      }
      const filtered = candidates
        .filter((p) => matchesFilters(p, request, now()))
        .slice(0, request.poolSize);
      // Preserve the fallback notice even when strict filters remove every fixture.
      if (!filtered.length && source !== mode) throw new NoCandidatesError(true);
      return structuredClone(filtered);
    },
  };
}

/** Guard Alan's future snapshot boundary. Google snapshot retention needs a separate design. */
export function candidateSnapshot(candidate: Candidate): Candidate {
  if (candidate.provider === 'google' || candidate.retention === 'request') {
    throw new Error(
      'Google content cannot be persisted as a Pick snapshot; use an approved ID-only design',
    );
  }
  return structuredClone(candidate);
}
