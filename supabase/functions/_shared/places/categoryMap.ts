import type { Category } from './types.ts';

/** Nearby Search (New) Table A types; deliberately bounded MVP categories. */
export const categoryMap: Readonly<Record<Category, readonly string[]>> = {
  food: ['restaurant', 'cafe', 'bakery'],
  activities: ['park', 'museum', 'movie_theater', 'bowling_alley', 'amusement_park', 'art_gallery'],
};

export function matchesCategory(types: readonly string[], category: Category): boolean {
  return types.some((type) => categoryMap[category].includes(type));
}
