import type { DiscoverFilter } from './discover';
export {
  ACTIVITY_TYPES,
  CUISINES,
  FOOD_TYPES,
  DISCOVER_SORTS,
} from '@shared/domain/discoverFilters.ts';
export type { DiscoverSort } from '@shared/domain/discoverFilters.ts';
export const METERS_PER_MILE = 1609.344;
export const DEFAULT_RADIUS_M = 5000;
export function milesToMeters(miles: number): number {
  if (!Number.isFinite(miles) || miles < 1 || miles > 25)
    throw new RangeError('Distance must be between 1 and 25 miles');
  return Math.round(miles * METERS_PER_MILE);
}
export interface DiscoverFilters {
  radiusM: number;
  priceMax: number;
  minRating: number;
  openNow: boolean;
  cuisines: string[];
  foodTypes: string[];
  activityTypes: string[];
}
export const defaultDiscoverFilters = (): DiscoverFilters => ({
  radiusM: DEFAULT_RADIUS_M,
  priceMax: -1,
  minRating: 0,
  openNow: false,
  cuisines: [],
  foodTypes: [],
  activityTypes: [],
});
/** Reset shared filters and the current category, preserving the other tab's choices. */
export function resetDiscoverFilters(
  current: DiscoverFilters,
  tab: DiscoverFilter,
): DiscoverFilters {
  return {
    ...current,
    radiusM: DEFAULT_RADIUS_M,
    priceMax: -1,
    minRating: 0,
    openNow: false,
    ...(tab === 'food'
      ? { cuisines: [], foodTypes: [] }
      : tab === 'activities'
        ? { activityTypes: [] }
        : {}),
  };
}
export function activeFilterCount(f: DiscoverFilters, tab: DiscoverFilter): number {
  return (
    Number(f.radiusM !== DEFAULT_RADIUS_M) +
    Number(f.priceMax >= 0) +
    Number(f.minRating > 0) +
    Number(f.openNow) +
    (tab === 'food'
      ? f.cuisines.length + f.foodTypes.length
      : tab === 'activities'
        ? f.activityTypes.length
        : 0)
  );
}
export function discoverFilterParams(f: DiscoverFilters, tab: DiscoverFilter) {
  return {
    radiusM: f.radiusM,
    priceMax: f.priceMax < 0 ? undefined : f.priceMax,
    openNow: f.openNow,
    ...(f.minRating ? { minRating: f.minRating } : {}),
    ...(tab === 'food' && f.cuisines.length ? { cuisines: [...f.cuisines].sort() } : {}),
    ...(tab === 'food' && f.foodTypes.length ? { foodTypes: [...f.foodTypes].sort() } : {}),
    ...(tab === 'activities' && f.activityTypes.length
      ? { activityTypes: [...f.activityTypes].sort() }
      : {}),
  };
}
