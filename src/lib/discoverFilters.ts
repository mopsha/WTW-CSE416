import type { DiscoverFilter } from './discover';
import {
  ACTIVITY_TYPES,
  CUISINES,
  DISCOVER_PRICES,
  FOOD_TYPES,
  type DiscoverFilterKey,
} from '@shared/domain/discoverFilters.ts';
export {
  ACTIVITY_TYPES,
  CUISINES,
  DISCOVER_PRICES,
  FOOD_TYPES,
  DISCOVER_SORTS,
} from '@shared/domain/discoverFilters.ts';
export type { DiscoverFilterKey, DiscoverSort } from '@shared/domain/discoverFilters.ts';
export const METERS_PER_MILE = 1609.344;
export const DEFAULT_RADIUS_M = 5000;
export function milesToMeters(miles: number): number {
  if (!Number.isFinite(miles) || miles < 1 || miles > 25)
    throw new RangeError('Distance must be between 1 and 25 miles');
  return Math.round(miles * METERS_PER_MILE);
}
export interface DiscoverFilters {
  radiusM: number;
  /** Exact price levels (1..4); empty means any price. Food only. */
  prices: number[];
  minRating: number;
  openNow: boolean;
  cuisines: string[];
  foodTypes: string[];
  activityTypes: string[];
}
export const defaultDiscoverFilters = (): DiscoverFilters => ({
  radiusM: DEFAULT_RADIUS_M,
  prices: [],
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
    prices: [],
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
    Number(tab !== 'activities' && f.prices.length > 0) +
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
    openNow: f.openNow,
    // Price is food-only: Activities never sends it, and For You applies it to food.
    ...(tab !== 'activities' && f.prices.length
      ? { prices: [...f.prices].sort((a, b) => a - b) }
      : {}),
    ...(f.minRating ? { minRating: f.minRating } : {}),
    ...(tab === 'food' && f.cuisines.length ? { cuisines: [...f.cuisines].sort() } : {}),
    ...(tab === 'food' && f.foodTypes.length ? { foodTypes: [...f.foodTypes].sort() } : {}),
    ...(tab === 'activities' && f.activityTypes.length
      ? { activityTypes: [...f.activityTypes].sort() }
      : {}),
  };
}

const priceLabel = (prices: readonly number[]) =>
  DISCOVER_PRICES.filter((o) => prices.includes(o.value))
    .map((o) => o.label)
    .join(' or ');
const typeLabels = (f: DiscoverFilters, tab: DiscoverFilter) =>
  (tab === 'food'
    ? [
        ...CUISINES.filter((o) => f.cuisines.includes(o.value)),
        ...FOOD_TYPES.filter((o) => f.foodTypes.includes(o.value)),
      ]
    : tab === 'activities'
      ? ACTIVITY_TYPES.filter((o) => f.activityTypes.includes(o.value))
      : []
  ).map((o) => o.label);

/** Names the filters that removed every place, in words for the empty state. */
export function emptyFilterMessage(
  keys: readonly DiscoverFilterKey[],
  f: DiscoverFilters,
  tab: DiscoverFilter,
): { title: string; body: string } | null {
  const parts = keys.flatMap((key) => {
    if (key === 'price') return [`${priceLabel(f.prices)} price${tab === 'all' ? ' (food)' : ''}`];
    if (key === 'rating') return [`rated ${f.minRating.toFixed(1)}+`];
    if (key === 'openNow') return ['open now'];
    const types = typeLabels(f, tab);
    return types.length ? [types.join(' or ')] : [];
  });
  if (!parts.length) return null;
  return {
    title:
      keys.length === 1 && keys[0] === 'price'
        ? `No ${priceLabel(f.prices)} places nearby.`
        : keys.length === 1 && keys[0] === 'openNow'
          ? 'Nothing nearby is open right now.'
          : 'No places match your filters.',
    body: `Nothing within ${(f.radiusM / METERS_PER_MILE).toFixed(1)} mi matches ${parts.join(', ')}. Clear filters or widen the distance.`,
  };
}
