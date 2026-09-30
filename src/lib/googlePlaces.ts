// DEMO: real venue photos + ratings from Google Places API (New), looked up at runtime by
// name + address. Enabled only when EXPO_PUBLIC_GOOGLE_PLACES_KEY is set (in .env.local,
// never committed). Nothing is stored: Google's terms don't allow caching photo references.
// Production should call Places from our API (server-side key), not from the app.
import { useEffect, useState } from 'react';
import { Image } from 'react-native';

import type { Candidate } from './types';

const KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_KEY ?? '';
export const GOOGLE_ENABLED = KEY.length > 0;

export interface GooglePhoto {
  url: string;
  /** The photographer credit Google requires next to its photos. */
  credit: string | null;
}

export interface GoogleInfo {
  /** Google's place id, for the on-demand details lookup. */
  id: string | null;
  photoUrl: string | null;
  /** The photographer credit Google requires next to its photos. */
  attribution: string | null;
  /** Up to 5 photos for the details gallery (media URLs; nothing is stored). */
  gallery: GooglePhoto[];
  rating: number | null;
  ratingCount: number | null;
}

interface SearchResponse {
  places?: {
    id?: string;
    rating?: number;
    userRatingCount?: number;
    photos?: { name: string; authorAttributions?: { displayName?: string }[] }[];
  }[];
}

const inflight = new Map<string, Promise<GoogleInfo | null>>();

const media = (name: string) =>
  `https://places.googleapis.com/v1/${name}/media?maxWidthPx=900&key=${encodeURIComponent(KEY)}`;

async function fetchInfo(place: Candidate): Promise<GoogleInfo | null> {
  const textQuery = [place.name, place.address, 'NY'].filter(Boolean).join(', ');
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': KEY,
      'X-Goog-FieldMask': 'places.id,places.rating,places.userRatingCount,places.photos',
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
    id: hit.id ?? null,
    photoUrl: photo ? media(photo.name) : null,
    attribution: photo?.authorAttributions?.[0]?.displayName ?? null,
    gallery: (hit.photos ?? []).slice(0, 5).map((p) => ({
      url: media(p.name),
      credit: p.authorAttributions?.[0]?.displayName ?? null,
    })),
    rating: hit.rating ?? null,
    ratingCount: hit.userRatingCount ?? null,
  };
}

/** Finished lookups, so a card mounts with the right photo instead of flashing the fallback. */
const resolved = new Map<string, GoogleInfo | null>();

/** One lookup per place per app session (in memory only). */
export function lookupGoogle(place: Candidate): Promise<GoogleInfo | null> {
  if (!GOOGLE_ENABLED) return Promise.resolve(null);
  let p = inflight.get(place.placeId);
  if (!p) {
    p = fetchInfo(place)
      .then((info) => {
        resolved.set(place.placeId, info);
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

/** Google info for a place (cached), for screens that need more than the enriched card. */
export function useGoogleInfo(place: Candidate): GoogleInfo | null {
  const [info, setInfo] = useState<GoogleInfo | null>(() => resolved.get(place.placeId) ?? null);
  useEffect(() => {
    let active = true;
    lookupGoogle(place).then((i) => active && setInfo(i));
    return () => {
      active = false;
    };
  }, [place]);
  return info;
}

export type EnrichedPlace = Candidate & { photoCredit: string | null };

/** The place with Google's photo and rating when available; otherwise unchanged. */
export function useEnrichedPlace(place: Candidate): EnrichedPlace {
  const info = useGoogleInfo(place);
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

export interface GoogleDetails {
  openNow: boolean | null;
  /** e.g. "Monday: 11:00 AM – 9:30 PM". */
  hours: string[];
  summary: string | null;
  phone: string | null;
  website: string | null;
  type: string | null;
}

interface DetailsResponse {
  currentOpeningHours?: { openNow?: boolean };
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  editorialSummary?: { text?: string };
  nationalPhoneNumber?: string;
  websiteUri?: string;
  primaryTypeDisplayName?: { text?: string };
}

const detailsCache = new Map<string, Promise<GoogleDetails | null>>();

/** Hours, description, phone and website: fetched only when the details sheet opens. */
export function lookupDetails(googleId: string): Promise<GoogleDetails | null> {
  if (!GOOGLE_ENABLED) return Promise.resolve(null);
  let p = detailsCache.get(googleId);
  if (!p) {
    p = fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(googleId)}`, {
      headers: {
        'X-Goog-Api-Key': KEY,
        'X-Goog-FieldMask':
          'currentOpeningHours.openNow,regularOpeningHours.weekdayDescriptions,editorialSummary,nationalPhoneNumber,websiteUri,primaryTypeDisplayName',
      },
    })
      .then(async (res) => {
        if (!res.ok) return null;
        const d = (await res.json()) as DetailsResponse;
        return {
          openNow: d.currentOpeningHours?.openNow ?? null,
          hours: d.regularOpeningHours?.weekdayDescriptions ?? [],
          summary: d.editorialSummary?.text ?? null,
          phone: d.nationalPhoneNumber ?? null,
          website: d.websiteUri ?? null,
          type: d.primaryTypeDisplayName?.text ?? null,
        };
      })
      .catch(() => null);
    detailsCache.set(googleId, p);
  }
  return p;
}
