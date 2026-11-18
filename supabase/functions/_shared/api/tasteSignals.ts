// Learning from Google places (owner: Alan). Spec: docs/taste-onboarding.md#learning.
// Google's place types can't be stored with a place, so 0047's triggers can't learn from
// Google candidates. Instead the API records the user's signal directly, with the type it
// has live at that moment: from the app for swipes and votes (the type is on the card), and
// from the server's own live read of the winner. Only "this user leaned toward <type>" is
// stored, never the place's type. 0051_google_taste_signals.sql verifies the action happened
// and derives the weight itself, so a client can only label its own action, never invent one.

import { TASTE_TYPES } from '../domain/groupTaste.ts';

export type TasteSignalKind = 'swipe' | 'vote' | 'winner';

export interface TasteSignalStore {
  /** Best effort; the database ignores anything it can't verify. */
  recordGoogleTaste?(
    userId: string,
    pickId: string,
    placeId: string,
    kind: TasteSignalKind,
    type: string,
  ): Promise<void>;
}

/** A survey place type, or null for anything else (older apps send nothing). */
export function surveyType(value: unknown): string | null {
  return typeof value === 'string' && TASTE_TYPES.has(value) ? value : null;
}

/**
 * Records one signal when the type is a survey type. Never throws: learning is optional and
 * must not fail the swipe, vote or read that triggered it. Returns whether it was sent.
 */
export async function recordGoogleTaste(
  store: TasteSignalStore,
  userId: string,
  pickId: string,
  placeId: unknown,
  kind: TasteSignalKind,
  type: unknown,
): Promise<boolean> {
  const t = surveyType(type);
  if (!t || typeof placeId !== 'string' || !placeId || !store.recordGoogleTaste) return false;
  try {
    await store.recordGoogleTaste(userId, pickId, placeId, kind, t);
    return true;
  } catch {
    return false;
  }
}

/** The optional `tasteType` an app sends with a swipe or vote body. */
export function bodyTasteType(body: unknown): unknown {
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>).tasteType
    : undefined;
}
