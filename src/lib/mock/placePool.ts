import fixtures from '../../../supabase/seed/places.json';
import { distanceMeters } from '@shared/domain/geo.ts';
import { matchesFilters, type PlaceFilters } from '@shared/domain/placeFilters.ts';
import type { Category } from '@shared/places/types.ts';
import { MOCK_PLACES, type MockPlace } from './fixtures';

export function mockPool(
  request: PlaceFilters & {
    category: Category;
    center: { lat: number; lng: number };
    radiusM: number;
  },
): MockPlace[] {
  // Keep the established food fixture IDs (existing demo answers refer to them).
  const source =
    request.category === 'food'
      ? MOCK_PLACES
      : fixtures
          .filter((p) => p.category === 'activities')
          .map((p) => ({
            ...p,
            cuisine: p.cuisine ?? null,
            address: p.address ?? null,
            photoUrl: p.photoUrl ?? null,
            priceLevel: p.priceLevel ?? null,
            rating: p.rating ?? null,
          }));
  return source.filter(
    (p) =>
      distanceMeters(request.center, p) <= request.radiusM &&
      matchesFilters(
        { ...p, address: p.address ?? undefined, category: request.category },
        request,
        new Date(),
      ),
  );
}
