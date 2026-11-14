import places from '../../../seed/places.json' with { type: 'json' };
import { distanceMeters } from '../domain/geo.ts';
import type { Candidate, PlaceProvider, PlaceSearch } from './types.ts';

const FIXTURE_TYPES: Record<string, string[]> = {
  Vietnamese: ['restaurant', 'vietnamese_restaurant'],
  'Seafood shack': ['restaurant', 'seafood_restaurant'],
  Seafood: ['restaurant', 'seafood_restaurant'],
  'Bubble tea': ['cafe'],
  Japanese: ['restaurant', 'japanese_restaurant'],
  Italian: ['restaurant', 'italian_restaurant'],
  Greek: ['restaurant', 'greek_restaurant'],
  American: ['restaurant', 'american_restaurant'],
  Chinese: ['restaurant', 'chinese_restaurant'],
  Mexican: ['restaurant', 'mexican_restaurant'],
  Thai: ['restaurant', 'thai_restaurant'],
  Korean: ['restaurant', 'korean_restaurant'],
  Indian: ['restaurant', 'indian_restaurant'],
  Pizza: ['restaurant', 'pizza_restaurant'],
  Burgers: ['restaurant', 'hamburger_restaurant'],
  'Modern Italian': ['restaurant', 'italian_restaurant'],
  'Classic American': ['restaurant', 'american_restaurant'],
  'New American': ['restaurant', 'american_restaurant'],
  'Café & brunch': ['cafe'],
  'Brunch & coffee': ['cafe'],
  'Healthy café': ['cafe'],
  'Tea room': ['cafe'],
  Cafe: ['cafe'],
  Bakery: ['bakery'],
  'French bistro': ['restaurant', 'french_restaurant'],
  'German gastropub': ['restaurant', 'german_restaurant'],
  Gastropub: ['restaurant'],
  'Diner & brunch': ['restaurant', 'brunch_restaurant'],
  'Nature walk': ['park'],
  Park: ['park'],
  'Waterfront park': ['park'],
  Hiking: ['hiking_area'],
  Sports: ['sports_complex'],
  'Beach & trails': ['beach', 'hiking_area'],
  Beach: ['beach'],
};
/** Bundled fixtures, not the team's approved Stony Brook place list. */
export class MockProvider implements PlaceProvider {
  async search({ center, radiusM, category, discovery }: PlaceSearch): Promise<Candidate[]> {
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
        return {
          ...place,
          category: place.category,
          ...(discovery?.cuisines?.length ||
          discovery?.foodTypes?.length ||
          discovery?.activityTypes?.length
            ? {
                types: FIXTURE_TYPES[place.cuisine] ?? [],
              }
            : {}),
        };
      });
  }
}
