// DEMO: real venue photos + ratings from Google Places API (New), looked up at runtime by
// name + address. Enabled only when EXPO_PUBLIC_GOOGLE_PLACES_KEY is set (in .env.local,
// never committed). Nothing is stored: Google's terms don't allow caching photo references.
// Production should call Places from our API (server-side key), not from the app.
import { useEffect, useState } from 'react';
import { Image } from 'react-native';

import type { Candidate } from './types';

const KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_KEY ?? '';
export const GOOGLE_ENABLED = KEY.length > 0;

export interface GoogleInfo {
  photoUrl: string | null;
  /** The photographer credit Google requires next to its photos. */
  attribution: string | null;
  rating: number | null;
  ratingCount: number | null;
}

interface SearchResponse {
  places?: {
    rating?: number;
    userRatingCount?: number;
    photos?: { name: string; authorAttributions?: { displayName?: string }[] }[];
  }[];
}

const inflight = new Map<string, Promise<GoogleInfo | null>>();

async function fetchInfo(place: Candidate): Promise<GoogleInfo | null> {
  const textQuery = [place.name, place.address, 'NY'].filter(Boolean).join(', ');
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': KEY,
      'X-Goog-FieldMask': 'places.rating,places.userRatingCount,places.photos',
    },
    body: JSON.stringify({
      textQuery,
      maxResultCount: 1,
      locationBias:
        place.lat !== null && place.lng !== null
          ? { circle: { center: { latitude: place.lat, longitude: place.lng }, radius: 500 } }
          : undefined,
    }),
  });
  if (!res.ok) return null;
  const hit = ((await res.json()) as SearchResponse).places?.[0];
  if (!hit) return null;
  const photo = hit.photos?.[0];
  return {
    photoUrl: photo
      ? `https://places.googleapis.com/v1/${photo.name}/media?maxWidthPx=900&key=${encodeURIComponent(KEY)}`
      : null,
    attribution: photo?.authorAttributions?.[0]?.displayName ?? null,
    rating: hit.rating ?? null,
    ratingCount: hit.userRatingCount ?? null,
  };
}

/** One lookup per place per app session (in memory only). */
export function lookupGoogle(place: Candidate): Promise<GoogleInfo | null> {
  if (!GOOGLE_ENABLED) return Promise.resolve(null);
  let p = inflight.get(place.placeId);
  if (!p) {
    p = fetchInfo(place)
      .then((info) => {
        if (info?.photoUrl) void Image.prefetch(info.photoUrl).catch(() => false);
        return info;
      })
      .catch(() => null);
    inflight.set(place.placeId, p);
  }
  return p;
}

/** Warm up every card's lookup + photo so swiping never waits. */
export function prefetchGoogle(places: readonly Candidate[]) {
  for (const p of places) void lookupGoogle(p);
}

export type EnrichedPlace = Candidate & { photoCredit: string | null };

/** The place with Google's photo and rating when available; otherwise unchanged. */
export function useEnrichedPlace(place: Candidate): EnrichedPlace {
  const [info, setInfo] = useState<GoogleInfo | null>(null);
  useEffect(() => {
    let active = true;
    lookupGoogle(place).then((i) => active && setInfo(i));
    return () => {
      active = false;
    };
  }, [place]);
  return {
    ...place,
    photoUrl: info?.photoUrl ?? place.photoUrl,
    rating: info?.rating ?? place.rating,
    photoCredit: info?.photoUrl
      ? info.attribution
        ? `${info.attribution} · Google`
        : 'Google'
      : null,
  };
}
