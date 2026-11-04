// Shows a Pick's Google places. Google's terms allow storing place IDs, and coordinates for 30
// days, but not names, addresses or photos. So a Pick stores only those (candidateSnapshot) and
// every read fetches the rest. See docs/google-picks.md.
import type { LatLng } from '../domain/geo.ts';
import { withPhotos, type ResolvePhoto } from '../api/discover.ts';
import type { Candidate, Category } from './types.ts';

/** Bounds the one-at-a-time lookups for places that dropped out of the repeat search. */
export const MAX_PLACE_LOOKUPS = 5;

export interface PickPlaceSource {
  /** One billable call returning up to 20 places, so far cheaper than a lookup per place. */
  search(query: { center: LatLng; radiusM: number; category: Category }): Promise<Candidate[]>;
  details(placeId: string, category: Category): Promise<Candidate | null>;
  photo: ResolvePhoto;
}

export interface PickPlacesRequest {
  center: LatLng;
  radiusM: number;
  candidates: { placeId: string; snapshot: object }[];
  /** Photos are billed one by one, so only these places get one. */
  photoIds: ReadonlySet<string>;
}
export type PickPlaces = (request: PickPlacesRequest) => Promise<object[]>;

const isGoogle = (snapshot: object) => (snapshot as { provider?: unknown }).provider === 'google';

/** A failed request leaves its places unnamed; it never fails the Pick. */
export function createPickPlaces(source: PickPlaceSource): PickPlaces {
  return async ({ center, radiusM, candidates, photoIds }) => {
    const stored = candidates.filter((c) => isGoogle(c.snapshot));
    if (!stored.length) return candidates.map((c) => c.snapshot);

    const categoryOf = (c: { snapshot: object }) =>
      (c.snapshot as { category?: Category }).category ?? 'food';
    const found = new Map<string, Candidate>();
    await Promise.all(
      [...new Set(stored.map(categoryOf))].map(async (category) => {
        try {
          for (const place of await source.search({ center, radiusM, category }))
            found.set(place.placeId, place);
        } catch {
          /* Falls through to the lookups below. */
        }
      }),
    );
    await Promise.all(
      stored
        .filter((c) => !found.has(c.placeId))
        .slice(0, MAX_PLACE_LOOKUPS)
        .map(async (c) => {
          try {
            const place = await source.details(c.placeId, categoryOf(c));
            if (place) found.set(c.placeId, place);
          } catch {
            /* Stays unnamed. */
          }
        }),
    );

    const wanted = stored.flatMap((c) => {
      const place = photoIds.has(c.placeId) ? found.get(c.placeId) : undefined;
      return place ? [place] : [];
    });
    for (const place of await withPhotos(wanted, source.photo)) found.set(place.placeId, place);

    return candidates.map(({ placeId, snapshot }) => {
      const place = isGoogle(snapshot) ? found.get(placeId) : undefined;
      if (!place) return snapshot;
      return {
        ...snapshot,
        name: place.name,
        address: place.address,
        lat: place.lat,
        lng: place.lng,
        photoUrl: photoIds.has(placeId) ? (place.photoUrl ?? null) : null,
        googleMapsUri: place.googleMapsUri,
        attributions: place.attributions ?? [],
      };
    });
  };
}
