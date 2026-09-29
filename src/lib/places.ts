import type { Candidate } from './types';

/**
 * Builds a Candidate from pick_candidates.snapshot (jsonb written by the API).
 * Expected keys: name, photoUrl, priceLevel (1–4), rating (0–5). Missing or
 * wrongly-typed fields become null so one bad row can't crash the Swipe screen.
 */
export function candidateFromSnapshot(placeId: string, snapshot: unknown): Candidate {
  const s =
    typeof snapshot === 'object' && snapshot !== null ? (snapshot as Record<string, unknown>) : {};
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    placeId,
    name: typeof s.name === 'string' && s.name ? s.name : 'Unnamed place',
    photoUrl: typeof s.photoUrl === 'string' && s.photoUrl ? s.photoUrl : null,
    priceLevel: num(s.priceLevel),
    rating: num(s.rating),
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
