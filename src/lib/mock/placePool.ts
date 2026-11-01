import { priorityCandidates } from '@shared/domain/candidatePriority.ts';
import type { MockPick } from './store';
import { savedPlaces, customPlaces } from './saved';
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
  const source: readonly MockPlace[] =
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
        {
          ...p,
          address: p.address ?? undefined,
          note: p.note ?? undefined,
          category: request.category,
        },
        request,
        new Date(),
      ),
  );
}

export function mockPickPool(pick: MockPick, rotate = false): MockPlace[] {
  const display = (p: { placeId: string; name: string; lat: number; lng: number }): MockPlace => ({
    photoUrl: null,
    priceLevel: null,
    rating: null,
    cuisine: null,
    address: null,
    ...p,
  });
  const priority: MockPlace[] = (pick.customOptions ?? []).map(display);
  if (pick.includeSaved) {
    const owned = new Map([
      ...fixtures.map(
        (p) =>
          [
            p.placeId,
            p.category === 'food'
              ? (MOCK_PLACES[Number(p.placeId.slice(-2)) - 1] ?? display(p))
              : display(p),
          ] as const,
      ),
      ...MOCK_PLACES.map((p) => [p.placeId, p] as const),
      ...[...customPlaces].map(([id, p]) => [id, display(p)] as const),
    ]);
    priority.push(
      ...[...savedPlaces.keys()]
        .flatMap((id) => (owned.has(id) ? [owned.get(id)!] : []))
        .filter(
          (p) =>
            (p.provider !== 'custom' || p.locationProvided === true) &&
            distanceMeters(pick.center, p) <= pick.radiusM &&
            matchesFilters(
              {
                ...p,
                address: p.address ?? undefined,
                note: p.note ?? undefined,
                category: pick.category,
              },
              pick,
              new Date(),
            ),
        ),
    );
  }
  const category = pick.category === 'custom' ? pick.mixCategory : pick.category;
  let found = category ? mockPool({ ...pick, category }) : [];
  if (rotate) {
    const shift = Math.floor(found.length / 3);
    found = [...found.slice(shift), ...found.slice(0, shift)];
  }
  return priorityCandidates(priority, found, pick.poolSize);
}
