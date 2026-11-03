import { ApiError } from '@shared/api/errors.ts';
import {
  groupIdeaCandidates,
  groupIdeaCategory,
  mixGroupIdeaCandidates,
  providerCategories,
  interleaveCandidates,
} from '@shared/domain/groupIdeaCandidates.ts';
import { mockGetGroup, mockGroupIdeas, mockGroupOfPick } from './groups';
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

let ideaSequence = 0;
export function mockPickPool(pick: MockPick, rotate = false): MockPlace[] {
  const display = (p: { placeId: string; name: string; lat: number; lng: number }): MockPlace => ({
    photoUrl: null,
    priceLevel: null,
    rating: null,
    cuisine: null,
    address: null,
    ...p,
  });
  let ideas: MockPlace[] = [];
  if (pick.includeGroupIdeas) {
    const groupId = mockGroupOfPick(pick.id);
    if (!groupId) throw new ApiError(409, 'GROUP_REQUIRED', 'This Pick no longer has a group');
    const group = mockGetGroup(groupId);
    if (!group || !group.members.some((m) => m.userId === pick.hostId))
      throw new ApiError(404, 'NOT_FOUND', 'Group or idea not found');
    const entries = [...mockGroupIdeas.values()].sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
    );
    ideas = groupIdeaCandidates(
      entries,
      groupId,
      groupIdeaCategory(pick.category, pick.mixCategory),
      pick.center,
      () => `12345678-0000-4000-8000-${(++ideaSequence).toString(16).padStart(12, '0')}`,
    ).map(display);
  }
  const category = pick.category === 'custom' ? pick.mixCategory : pick.category;
  const priority: MockPlace[] = (pick.customOptions ?? []).map(display);
  if (pick.includeSaved) {
    const owned = new Map([
      ...fixtures
        .filter((p) =>
          category === 'both'
            ? p.category === 'food' || p.category === 'activities'
            : p.category === category,
        )
        .map(
          (p) =>
            [
              p.placeId,
              p.category === 'food'
                ? (MOCK_PLACES[Number(p.placeId.slice(-2)) - 1] ?? display(p))
                : display(p),
            ] as const,
        ),
      ...(category === 'food' || category === 'both'
        ? MOCK_PLACES.map((p) => [p.placeId, p] as const)
        : []),
      ...[...customPlaces]
        .filter(() => pick.category === 'custom')
        .map(([id, p]) => [id, display(p)] as const),
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
                category: pick.category === 'both' ? 'food' : pick.category,
              },
              pick,
              new Date(),
            ),
        ),
    );
  }
  let found = interleaveCandidates(
    providerCategories(pick.category, pick.mixCategory).map((category) =>
      mockPool({ ...pick, category }),
    ),
  );
  if (rotate) {
    const shift = Math.floor(found.length / 3);
    found = [...found.slice(shift), ...found.slice(0, shift)];
  }
  const base = priorityCandidates(priority, found, pick.poolSize);
  const mixed = pick.includeGroupIdeas
    ? mixGroupIdeaCandidates(base, ideas, pick.poolSize, pick.customOptions?.length ?? 0)
    : base;
  for (const candidate of mixed)
    if (candidate.origin === 'group_idea')
      customPlaces.set(candidate.placeId, {
        ...candidate,
        category: 'custom',
        provider: 'custom',
        createdBy: candidate.createdBy!,
        address: candidate.address ?? undefined,
        note: candidate.note ?? undefined,
        locationProvided: false,
      });
  return mixed;
}
