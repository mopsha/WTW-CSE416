import { ApiError } from './errors.ts';
import { validFilters } from '../domain/placeFilters.ts';
import { rankDiscover, type DiscoverPreferences } from '../domain/discoverScore.ts';
import type { PoolBuilder, PoolRequest } from '../places/pool.ts';
import { NoCandidatesError } from '../places/pool.ts';

export function parseDiscover(params: URLSearchParams): PoolRequest[] {
  const lat = params.get('lat'),
    lng = params.get('lng');
  const radiusM = Number(params.get('radiusM') ?? 5000);
  const category = params.get('category') ?? 'all';
  const priceMax = params.has('priceMax') ? Number(params.get('priceMax')) : null;
  const open = params.get('openNow');
  if (
    lat === null ||
    lng === null ||
    !lat.trim() ||
    !lng.trim() ||
    !Number.isFinite(Number(lat)) ||
    Math.abs(Number(lat)) > 90 ||
    !Number.isFinite(Number(lng)) ||
    Math.abs(Number(lng)) > 180 ||
    !Number.isInteger(radiusM) ||
    radiusM < 200 ||
    radiusM > 50000 ||
    !['all', 'food', 'activities'].includes(category) ||
    (open !== null && open !== 'true' && open !== 'false') ||
    (params.has('priceMax') && !params.get('priceMax')?.trim()) ||
    !validFilters({ priceMax })
  ) {
    throw new ApiError(400, 'INVALID_INPUT', 'Invalid Discover location or filters');
  }
  return (
    category === 'all' ? (['food', 'activities'] as const) : [category as 'food' | 'activities']
  ).map((category) => ({
    center: { lat: Number(lat), lng: Number(lng) },
    radiusM,
    category,
    poolSize: 30,
    priceMax,
    openNow: open === 'true',
  }));
}

export async function discover(
  pool: PoolBuilder,
  requests: PoolRequest[],
  preferences: DiscoverPreferences,
) {
  const groups = await Promise.all(
    requests.map(async (request) => {
      try {
        const places = await pool.buildPool(request);
        return { places, fallback: places.some((p) => p.provider === 'mock') };
      } catch (error) {
        if (error instanceof NoCandidatesError)
          return { places: [], fallback: error.fallbackAttempted };
        throw error;
      }
    }),
  );
  const places = rankDiscover(
    groups.flatMap((group) => group.places),
    preferences,
    requests[0]!.center,
  );
  return { places, fallback: groups.some((group) => group.fallback) };
}
