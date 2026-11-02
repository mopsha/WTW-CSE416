import { distanceMeters, type LatLng } from './geo.ts';
import type { Candidate } from '../places/types.ts';

export interface DiscoverPreferences {
  categories?: string[];
  types?: string[];
  priceMax?: number | null;
}

/** Individual feed only; does not participate in Pick ranking or voting. */
export function discoverScore(
  place: Candidate,
  preferences: DiscoverPreferences,
  center: LatLng,
): number {
  const category = preferences.categories?.includes(place.category) ? 4 : 0;
  const types = (place.types ?? []).some((type) => preferences.types?.includes(type)) ? 3 : 0;
  const price =
    preferences.priceMax != null &&
    place.priceLevel != null &&
    place.priceLevel <= preferences.priceMax
      ? 2
      : 0;
  const rating =
    typeof place.rating === 'number' && Number.isFinite(place.rating)
      ? Math.max(0, Math.min(5, place.rating)) / 5
      : 0;
  return category + types + price + rating + 1 / (1 + distanceMeters(center, place) / 1000);
}

export function rankDiscover(
  places: Candidate[],
  preferences: DiscoverPreferences,
  center: LatLng,
): Candidate[] {
  const unique = new Map(places.map((place) => [place.placeId, place]));
  return [...unique.values()]
    .sort(
      (a, b) =>
        discoverScore(b, preferences, center) - discoverScore(a, preferences, center) ||
        (a.placeId < b.placeId ? -1 : a.placeId > b.placeId ? 1 : 0),
    )
    .slice(0, 20);
}
