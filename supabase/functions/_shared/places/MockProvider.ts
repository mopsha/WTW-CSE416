import places from '../../../seed/places.json' with { type: 'json' };
import { distanceMeters } from '../domain/geo.ts';
import type { Candidate, PlaceProvider, PlaceSearch } from './types.ts';

/** Bundled fixtures, not the team's approved Stony Brook place list. */
export class MockProvider implements PlaceProvider {
  async search({ center, radiusM, category }: PlaceSearch): Promise<Candidate[]> {
    if (
      !Number.isFinite(radiusM) ||
      radiusM < 0 ||
      !Number.isFinite(center.lat) ||
      Math.abs(center.lat) > 90 ||
      !Number.isFinite(center.lng) ||
      Math.abs(center.lng) > 180
    ) {
      throw new RangeError('Search requires valid coordinates and a nonnegative radius in meters');
    }
    return places
      .filter(
        (place) =>
          (!category || place.category === category) && distanceMeters(center, place) <= radiusM,
      )
      .map((place) => {
        if (place.category !== 'food' && place.category !== 'activities') {
          throw new TypeError('Unknown fixture category');
        }
        return { ...place, category: place.category };
      });
  }
}
