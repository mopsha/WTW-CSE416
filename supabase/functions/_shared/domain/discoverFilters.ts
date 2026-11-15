import type { Candidate, Category } from '../places/types.ts';
import { categoryMap } from '../places/categoryMap.ts';

export const CUISINES = [
  { value: 'american', label: 'American', types: ['american_restaurant'] },
  { value: 'italian', label: 'Italian', types: ['italian_restaurant'] },
  { value: 'mexican', label: 'Mexican', types: ['mexican_restaurant'] },
  { value: 'chinese', label: 'Chinese', types: ['chinese_restaurant'] },
  { value: 'japanese', label: 'Japanese', types: ['japanese_restaurant'] },
  { value: 'indian', label: 'Indian', types: ['indian_restaurant'] },
  { value: 'korean', label: 'Korean', types: ['korean_restaurant'] },
  {
    value: 'mediterranean',
    label: 'Mediterranean',
    types: ['mediterranean_restaurant', 'greek_restaurant'],
  },
  { value: 'thai', label: 'Thai', types: ['thai_restaurant'] },
] as const;
export const FOOD_TYPES = [
  { value: 'restaurants', label: 'Restaurants', types: ['restaurant'] },
  { value: 'fast_food', label: 'Fast food', types: ['fast_food_restaurant'] },
  { value: 'cafes', label: 'Cafés', types: ['cafe', 'coffee_shop'] },
  { value: 'bakeries', label: 'Bakeries', types: ['bakery'] },
  { value: 'dessert', label: 'Dessert', types: ['dessert_shop', 'ice_cream_shop'] },
  { value: 'pizza', label: 'Pizza', types: ['pizza_restaurant'] },
  { value: 'burgers', label: 'Burgers', types: ['hamburger_restaurant'] },
] as const;
export const ACTIVITY_TYPES = [
  { value: 'bowling', label: 'Bowling', types: ['bowling_alley'] },
  { value: 'arcades', label: 'Arcades', types: ['video_arcade'] },
  { value: 'movies', label: 'Movies', types: ['movie_theater'] },
  { value: 'mini_golf', label: 'Mini golf', types: ['miniature_golf_course'] },
  { value: 'sports', label: 'Sports', types: ['sports_complex', 'athletic_field', 'stadium'] },
  { value: 'shopping', label: 'Shopping malls', types: ['shopping_mall'] },
  { value: 'museums', label: 'Museums', types: ['museum'] },
  {
    value: 'parks',
    label: 'Parks and hiking',
    types: ['park', 'hiking_area', 'state_park', 'national_park'],
  },
] as const;
export const DISCOVER_SORTS = [
  { value: 'recommended', label: 'Recommended' },
  { value: 'nearest', label: 'Nearest' },
  { value: 'rating', label: 'Highest rated' },
  { value: 'reviews', label: 'Most reviewed' },
] as const;
export type DiscoverSort = (typeof DISCOVER_SORTS)[number]['value'];
export interface DiscoverConstraints {
  cuisines?: readonly string[];
  foodTypes?: readonly string[];
  activityTypes?: readonly string[];
  minRating?: number;
  sort?: DiscoverSort;
}
type Catalog = readonly { value: string; types: readonly string[] }[];
const selectedTypes = (catalog: Catalog, values: readonly string[] = []) =>
  catalog.filter((o) => values.includes(o.value)).flatMap((o) => [...o.types]);
const validSelection = (values: readonly string[] | undefined, catalog: Catalog) =>
  values === undefined ||
  (Array.isArray(values) &&
    values.length <= catalog.length &&
    new Set(values).size === values.length &&
    values.every((v) => catalog.some((o) => o.value === v)));
export function validDiscovery(value: DiscoverConstraints, category?: string): boolean {
  return (
    validSelection(value.cuisines, CUISINES) &&
    validSelection(value.foodTypes, FOOD_TYPES) &&
    validSelection(value.activityTypes, ACTIVITY_TYPES) &&
    (value.minRating === undefined || [3.5, 4, 4.5].includes(value.minRating)) &&
    (value.sort === undefined || DISCOVER_SORTS.some((o) => o.value === value.sort)) &&
    (category === 'food' || !(value.cuisines?.length || value.foodTypes?.length)) &&
    (category === 'activities' || !value.activityTypes?.length)
  );
}
/** One OR list per provider search. Cuisine wins when both Food sections are selected;
 * the second section is AND-matched over the returned candidates, before the final limit. */
export function discoverSearchTypes(category: Category, filters: DiscoverConstraints): string[] {
  if (category === 'food') {
    if (filters.cuisines?.length) return selectedTypes(CUISINES, filters.cuisines);
    if (filters.foodTypes?.length) return selectedTypes(FOOD_TYPES, filters.foodTypes);
  } else if (filters.activityTypes?.length)
    return selectedTypes(ACTIVITY_TYPES, filters.activityTypes);
  return [...categoryMap[category]];
}
export function matchesDiscovery(place: Candidate, filters: DiscoverConstraints = {}): boolean {
  if (
    filters.minRating !== undefined &&
    !(
      typeof place.rating === 'number' &&
      Number.isFinite(place.rating) &&
      place.rating >= filters.minRating
    )
  )
    return false;
  const matches = (catalog: Catalog, values?: readonly string[]) =>
    !values?.length || selectedTypes(catalog, values).some((t) => place.types?.includes(t));
  return (
    matches(CUISINES, filters.cuisines) &&
    matches(FOOD_TYPES, filters.foodTypes) &&
    matches(ACTIVITY_TYPES, filters.activityTypes)
  );
}
