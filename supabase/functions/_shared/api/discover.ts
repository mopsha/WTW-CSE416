import {
  applyDiscoverFilters,
  validDiscovery,
  type DiscoverConstraints,
  type DiscoverFilterKey,
} from '../domain/discoverFilters.ts';
import { distanceMeters } from '../domain/geo.ts';
import { ApiError } from './errors.ts';
import { validFilters } from '../domain/placeFilters.ts';
import { rankDiscover, type DiscoverPreferences } from '../domain/discoverScore.ts';
import type { PoolBuilder, PoolRequest } from '../places/pool.ts';
import { NoCandidatesError } from '../places/pool.ts';
import type { Candidate } from '../places/types.ts';

export type ResolvePhoto = (name: string) => Promise<string>;

/** A Google photo resource name. Stricter than the provider so nothing extra reaches the URL. */
export const DISCOVER_PHOTO_NAME = /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/;

/** Adds each Google place's first photo and its required credit; a failed photo stays emoji. */
export function withPhotos(places: Candidate[], resolve: ResolvePhoto): Promise<Candidate[]> {
  return Promise.all(
    places.map(async (place) => {
      const photo = place.photos?.[0];
      if (place.provider !== 'google' || !photo) return place;
      try {
        return {
          ...place,
          photoUrl: await resolve(photo.name),
          attributions: [
            ...(place.attributions ?? []),
            ...photo.authorAttributions.map((author) => ({
              provider: author.displayName,
              providerUri: author.uri,
            })),
          ],
        };
      } catch {
        return place;
      }
    }),
  );
}

export function parseDiscover(params: URLSearchParams): PoolRequest[] {
  const lat = params.get('lat'),
    lng = params.get('lng');
  const radiusM = Number(params.get('radiusM') ?? 5000);
  const category = params.get('category') ?? 'all';
  // Older app builds send a maximum price; it keeps its old meaning, for food only.
  const priceMax = params.has('priceMax') ? Number(params.get('priceMax')) : null;
  const open = params.get('openNow');
  const selection = (key: string) =>
    params.has(key) ? params.get(key)!.split(',').sort() : undefined;
  const prices = params.has('prices')
    ? params
        .get('prices')!
        .split(',')
        .map((v) => (/^[1-4]$/.test(v) ? Number(v) : NaN))
        .sort((a, b) => a - b)
    : undefined;
  const discovery: DiscoverConstraints = {
    ...(params.has('cuisines') ? { cuisines: selection('cuisines') } : {}),
    ...(params.has('foodTypes') ? { foodTypes: selection('foodTypes') } : {}),
    ...(params.has('activityTypes') ? { activityTypes: selection('activityTypes') } : {}),
    ...(params.has('minRating') ? { minRating: Number(params.get('minRating')) } : {}),
    ...(prices ? { prices } : {}),
    ...(open === 'true' ? { openNow: true } : {}),
    ...(params.has('sort') ? { sort: params.get('sort') as DiscoverConstraints['sort'] } : {}),
  };
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
    !validFilters({ priceMax }) ||
    (priceMax !== null && prices !== undefined) ||
    !validDiscovery(discovery, category)
  ) {
    throw new ApiError(400, 'INVALID_INPUT', 'Invalid Discover location or filters');
  }
  return (
    category === 'all' ? (['food', 'activities'] as const) : [category as 'food' | 'activities']
  ).map((category) => {
    // Price is food-only, so an activities search never carries it.
    const shared: DiscoverConstraints = { ...discovery };
    delete shared.prices;
    return {
      center: { lat: Number(lat), lng: Number(lng) },
      radiusM,
      category,
      poolSize: 30,
      priceMax: category === 'food' ? priceMax : null,
      // discover() applies Open Now itself, so the pool must not drop places without hours.
      openNow: false,
      discovery: category === 'food' ? discovery : shared,
    };
  });
}

export interface DiscoverResult {
  places: Candidate[];
  fallback: boolean;
  /** Which filters removed every place; empty when places are shown. */
  emptyBecause: DiscoverFilterKey[];
  /** Open Now: how many places had no listed hours. */
  hoursUnknown: number;
  /** Open Now: no place was known to be open, so places with unverified hours are shown. */
  hoursUnverified: boolean;
}

export async function discover(
  pool: PoolBuilder,
  requests: PoolRequest[],
  preferences: DiscoverPreferences,
  now: Date = new Date(),
): Promise<DiscoverResult> {
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
  // The food request carries prices; matchesPrice ignores them for activities.
  const filters =
    requests.find((r) => r.category === 'food')?.discovery ?? requests[0]!.discovery ?? {};
  const filtered = applyDiscoverFilters(
    groups.flatMap((group) => group.places),
    filters,
    now,
  );
  const candidates = filtered.places;
  const center = requests[0]!.center;
  const sort = requests[0]!.discovery?.sort ?? 'recommended';
  const metric = (p: Candidate) =>
    sort === 'nearest'
      ? -distanceMeters(center, p)
      : sort === 'rating'
        ? (p.rating ?? -1)
        : (p.userRatingCount ?? -1);
  const places =
    sort === 'recommended'
      ? rankDiscover(candidates, preferences, center)
      : [...new Map(candidates.map((p) => [p.placeId, p])).values()]
          .sort(
            (a, b) =>
              metric(b) - metric(a) || (a.placeId < b.placeId ? -1 : a.placeId > b.placeId ? 1 : 0),
          )
          .slice(0, 20);
  return {
    places,
    fallback: groups.some((group) => group.fallback),
    emptyBecause: filtered.emptyBecause,
    hoursUnknown: filtered.hoursUnknown,
    hoursUnverified: filtered.hoursUnverified,
  };
}
