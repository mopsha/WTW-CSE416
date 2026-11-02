import type { Candidate } from '@shared/places/types.ts';
import { DISCOVER_PLACES, milesBetween, type DiscoverPlace } from './discover';
import { candidateFromApi } from './places';

export function discoverPlace(
  place: Candidate,
  center: { lat: number; lng: number },
): DiscoverPlace {
  if (place.category === 'custom') throw new Error('Custom options do not belong in Discover');
  const local =
    place.provider === 'mock'
      ? DISCOVER_PLACES.find((p) => p.placeId === place.placeId)
      : undefined;
  return {
    ...candidateFromApi(place),
    ...local,
    category: place.category,
    providerCredits:
      place.provider === 'google'
        ? ['Google Maps', ...(place.attributions ?? []).map((a) => a.provider)]
        : undefined,
    kind: local?.kind ?? (place.category === 'food' ? 'Food' : 'Activity'),
    emoji: local?.emoji ?? (place.category === 'food' ? '🍽️' : '🎳'),
    lat: place.lat,
    lng: place.lng,
    miles: milesBetween(center, place),
  };
}
