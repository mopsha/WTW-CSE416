// The onboarding survey (FR-02), stored in profiles.discover_preferences. categories, types
// and priceMax are the keys Discover scores with (discoverScore.ts); dislikedTypes and
// maxDistanceM are kept for Pick defaults. Type values are Places API (New) Table A types.

export type PreferenceCategory = 'food' | 'activities';

export interface Preferences {
  /** What I want to find. */
  categories: PreferenceCategory[];
  /** Place types I like (cuisines and activities). */
  types: string[];
  /** Cuisines I'd rather skip. Never also in types. */
  dislikedTypes: string[];
  /** Highest price level I'm happy with, 1 ($) to 4 ($$$$); null = no limit. */
  priceMax: number | null;
  /** How far I'll usually go, in meters; null = no preference. */
  maxDistanceM: number | null;
}

export const EMPTY_PREFERENCES: Preferences = {
  categories: [],
  types: [],
  dislikedTypes: [],
  priceMax: null,
  maxDistanceM: null,
};

export interface PreferenceOption<T> {
  value: T;
  label: string;
}

export const CATEGORY_OPTIONS: readonly PreferenceOption<PreferenceCategory>[] = [
  { value: 'food', label: '🍜 Food' },
  { value: 'activities', label: '🎳 Activities' },
];

export const FOOD_TYPE_OPTIONS: readonly PreferenceOption<string>[] = [
  { value: 'american_restaurant', label: 'American' },
  { value: 'hamburger_restaurant', label: 'Burgers' },
  { value: 'pizza_restaurant', label: 'Pizza' },
  { value: 'italian_restaurant', label: 'Italian' },
  { value: 'mexican_restaurant', label: 'Mexican' },
  { value: 'chinese_restaurant', label: 'Chinese' },
  { value: 'japanese_restaurant', label: 'Japanese' },
  { value: 'sushi_restaurant', label: 'Sushi' },
  { value: 'ramen_restaurant', label: 'Ramen' },
  { value: 'korean_restaurant', label: 'Korean' },
  { value: 'thai_restaurant', label: 'Thai' },
  { value: 'indian_restaurant', label: 'Indian' },
  { value: 'mediterranean_restaurant', label: 'Mediterranean' },
  { value: 'seafood_restaurant', label: 'Seafood' },
  { value: 'vegetarian_restaurant', label: 'Vegetarian' },
  { value: 'breakfast_restaurant', label: 'Breakfast' },
  { value: 'cafe', label: 'Cafés' },
  { value: 'bakery', label: 'Bakeries' },
  { value: 'ice_cream_shop', label: 'Ice cream' },
];

export const ACTIVITY_TYPE_OPTIONS: readonly PreferenceOption<string>[] = [
  { value: 'movie_theater', label: 'Movies' },
  { value: 'bowling_alley', label: 'Bowling' },
  { value: 'miniature_golf_course', label: 'Mini golf' },
  { value: 'amusement_park', label: 'Amusement parks' },
  { value: 'park', label: 'Parks' },
  { value: 'hiking_area', label: 'Hiking' },
  { value: 'beach', label: 'Beaches' },
  { value: 'museum', label: 'Museums' },
  { value: 'art_gallery', label: 'Art galleries' },
  { value: 'performing_arts_theater', label: 'Shows' },
  { value: 'botanical_garden', label: 'Gardens' },
  { value: 'zoo', label: 'Zoos' },
];

export const PRICE_OPTIONS: readonly PreferenceOption<number>[] = [
  { value: 1, label: '$' },
  { value: 2, label: '$$' },
  { value: 3, label: '$$$' },
  { value: 4, label: '$$$$' },
];

const MILE = 1609;

export const DISTANCE_OPTIONS: readonly PreferenceOption<number>[] = [
  { value: 1 * MILE, label: '1 mi' },
  { value: 3 * MILE, label: '3 mi' },
  { value: 5 * MILE, label: '5 mi' },
  { value: 10 * MILE, label: '10 mi' },
  { value: 25 * MILE, label: '25 mi' },
];

const CATEGORIES = new Set(CATEGORY_OPTIONS.map((o) => o.value));
const FOOD_TYPES = new Set(FOOD_TYPE_OPTIONS.map((o) => o.value));
const LIKABLE_TYPES = new Set([...FOOD_TYPES, ...ACTIVITY_TYPE_OPTIONS.map((o) => o.value)]);
const DISTANCES = new Set(DISTANCE_OPTIONS.map((o) => o.value));

/** Longest list a request may send (duplicates included); far more than the options. */
const MAX_LIST = 50;

function stringList(value: unknown, allowed: Set<string>): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_LIST) return null;
  if (value.some((v) => typeof v !== 'string' || !allowed.has(v))) return null;
  return [...new Set(value as string[])];
}

function optionalNumber(value: unknown, allowed: (n: number) => boolean): number | null | false {
  if (value === undefined || value === null) return null;
  return typeof value === 'number' && allowed(value) ? value : false;
}

/** Survey answers from a request body, or an error message. Only listed options are accepted. */
export function validatePreferences(
  value: unknown,
): { preferences: Preferences } | { error: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { error: 'Expected your preferences' };
  }
  const raw = value as Record<string, unknown>;
  const categories = stringList(raw.categories, CATEGORIES);
  if (!categories) return { error: 'Pick food, activities, or both' };
  const types = stringList(raw.types, LIKABLE_TYPES);
  if (!types) return { error: 'Unknown place type' };
  const dislikedTypes = stringList(raw.dislikedTypes, FOOD_TYPES);
  if (!dislikedTypes) return { error: 'Unknown cuisine to skip' };
  if (dislikedTypes.some((t) => types.includes(t))) {
    return { error: 'A cuisine can’t be liked and skipped' };
  }
  const priceMax = optionalNumber(raw.priceMax, (n) => Number.isInteger(n) && n >= 1 && n <= 4);
  if (priceMax === false) return { error: 'Budget must be $ to $$$$' };
  const maxDistanceM = optionalNumber(raw.maxDistanceM, (n) => DISTANCES.has(n));
  if (maxDistanceM === false) return { error: 'Unknown distance' };
  return {
    preferences: {
      categories: categories as PreferenceCategory[],
      types,
      dislikedTypes,
      priceMax,
      maxDistanceM,
    },
  };
}

/** Stored preferences, tolerating missing or older keys: anything invalid reads as unset. */
export function readPreferences(stored: unknown): Preferences {
  const raw =
    typeof stored === 'object' && stored !== null && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)
      : {};
  const pick = <K extends keyof Preferences>(key: K): Preferences[K] => {
    const result = validatePreferences({ [key]: raw[key] });
    return 'preferences' in result ? result.preferences[key] : EMPTY_PREFERENCES[key];
  };
  return {
    categories: pick('categories'),
    types: pick('types'),
    dislikedTypes: pick('dislikedTypes'),
    priceMax: pick('priceMax'),
    maxDistanceM: pick('maxDistanceM'),
  };
}
