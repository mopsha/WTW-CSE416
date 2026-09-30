import type { Candidate } from './types';

/**
 * Builds a Candidate from pick_candidates.snapshot (jsonb written by the API).
 * Expected keys: name, photoUrl, priceLevel (1–4), rating (0–5), cuisine, address, lat, lng.
 * Missing or wrongly-typed fields become null so one bad row can't crash the Swipe screen.
 */
export function candidateFromSnapshot(placeId: string, snapshot: unknown): Candidate {
  const s =
    typeof snapshot === 'object' && snapshot !== null ? (snapshot as Record<string, unknown>) : {};
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  return {
    placeId,
    name: str(s.name) ?? 'Unnamed place',
    photoUrl: str(s.photoUrl),
    priceLevel: num(s.priceLevel),
    rating: num(s.rating),
    cuisine: str(s.cuisine),
    address: str(s.address),
    lat: num(s.lat),
    lng: num(s.lng),
  };
}

/** 2 -> "$$". */
export function formatPriceLevel(level: number | null): string | null {
  if (level === null || level < 1) return null;
  return '$'.repeat(Math.min(4, Math.round(level)));
}

/** 1 -> "1st", 2 -> "2nd", 3 -> "3rd", 11 -> "11th". */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** SBU Academic Mall: where the demo Pick is centered. */
export const CAMPUS = { lat: 40.9126, lng: -73.1234 };

/** "0.6 mi" from campus, or null without coordinates. */
export function milesFromCampus(place: { lat: number | null; lng: number | null }): string | null {
  if (place.lat === null || place.lng === null) return null;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(place.lat - CAMPUS.lat);
  const dLng = toRad(place.lng - CAMPUS.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(CAMPUS.lat)) * Math.cos(toRad(place.lat)) * Math.sin(dLng / 2) ** 2;
  const miles = 2 * 3958.8 * Math.asin(Math.sqrt(h));
  return miles < 0.1 ? 'on campus' : `${miles.toFixed(1)} mi`;
}
