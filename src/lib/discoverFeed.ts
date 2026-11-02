import type { Candidate } from '@shared/places/types.ts';
import { DISCOVER_PLACES, milesBetween, type DiscoverPlace } from './discover';
import { candidateFromApi } from './places';

type Kinds = readonly (readonly [type: string, kind: string, emoji: string])[];

// Google lists several types per place, so the most specific ones come first.
const FOOD_KINDS: Kinds = [
  ['pizza_restaurant', 'Pizza', '🍕'],
  ['sushi_restaurant', 'Sushi', '🍣'],
  ['ramen_restaurant', 'Ramen', '🍜'],
  ['vietnamese_restaurant', 'Vietnamese', '🍜'],
  ['thai_restaurant', 'Thai', '🍜'],
  ['chinese_restaurant', 'Chinese', '🥡'],
  ['japanese_restaurant', 'Japanese', '🍱'],
  ['korean_restaurant', 'Korean', '🍲'],
  ['indian_restaurant', 'Indian', '🍛'],
  ['mexican_restaurant', 'Mexican', '🌮'],
  ['italian_restaurant', 'Italian', '🍝'],
  ['greek_restaurant', 'Greek', '🥙'],
  ['mediterranean_restaurant', 'Mediterranean', '🥙'],
  ['middle_eastern_restaurant', 'Middle Eastern', '🥙'],
  ['seafood_restaurant', 'Seafood', '🦞'],
  ['steak_house', 'Steakhouse', '🥩'],
  ['barbecue_restaurant', 'BBQ', '🍖'],
  ['hamburger_restaurant', 'Burgers', '🍔'],
  ['sandwich_shop', 'Sandwiches', '🥪'],
  ['fast_food_restaurant', 'Fast food', '🍟'],
  ['breakfast_restaurant', 'Breakfast', '🍳'],
  ['brunch_restaurant', 'Brunch', '🥞'],
  ['ice_cream_shop', 'Ice cream', '🍦'],
  ['donut_shop', 'Donuts', '🍩'],
  ['dessert_shop', 'Dessert', '🍰'],
  ['bakery', 'Bakery', '🥐'],
  ['coffee_shop', 'Coffee', '☕'],
  ['cafe', 'Cafe', '☕'],
  ['bar', 'Bar', '🍺'],
  ['american_restaurant', 'American', '🍔'],
];
const ACTIVITY_KINDS: Kinds = [
  ['zoo', 'Zoo', '🦁'],
  ['aquarium', 'Aquarium', '🐠'],
  ['amusement_park', 'Amusement park', '🎢'],
  ['miniature_golf_course', 'Mini golf', '⛳'],
  ['bowling_alley', 'Bowling', '🎳'],
  ['performing_arts_theater', 'Theater', '🎭'],
  ['concert_hall', 'Music venue', '🎵'],
  ['movie_theater', 'Movies', '🎬'],
  ['art_gallery', 'Art gallery', '🎨'],
  ['museum', 'Museum', '🏛️'],
  ['winery', 'Winery', '🍇'],
  ['botanical_garden', 'Garden', '🌷'],
  ['beach', 'Beach', '🏖️'],
  ['hiking_area', 'Hiking', '🥾'],
  ['sports_complex', 'Sports', '🏟️'],
  ['athletic_field', 'Sports', '🏟️'],
  ['state_park', 'State park', '🌲'],
  ['park', 'Park', '🌳'],
];

/** A label and icon from Google's place types, or a generic one for types we don't list. */
export function googleKind(
  types: readonly string[] | undefined,
  category: 'food' | 'activities',
): { kind: string; emoji: string } {
  const match = (category === 'food' ? FOOD_KINDS : ACTIVITY_KINDS).find(([type]) =>
    types?.includes(type),
  );
  if (match) return { kind: match[1], emoji: match[2] };
  return category === 'food' ? { kind: 'Food', emoji: '🍽️' } : { kind: 'Activity', emoji: '📍' };
}

export function discoverPlace(
  place: Candidate,
  center: { lat: number; lng: number },
): DiscoverPlace {
  if (place.category === 'custom') throw new Error('Custom options do not belong in Discover');
  const local =
    place.provider === 'mock'
      ? DISCOVER_PLACES.find((p) => p.placeId === place.placeId)
      : undefined;
  const { kind, emoji } = local ?? googleKind(place.types, place.category);
  return {
    ...candidateFromApi(place),
    cuisine: kind,
    ...local,
    category: place.category,
    providerCredits:
      place.provider === 'google'
        ? ['Google Maps', ...(place.attributions ?? []).map((a) => a.provider)]
        : undefined,
    kind,
    emoji,
    lat: place.lat,
    lng: place.lng,
    miles: milesBetween(center, place),
  };
}
