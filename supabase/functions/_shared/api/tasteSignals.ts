// Learning from Google places (owner: Alan). Spec: docs/taste-onboarding.md#learning.
// Google's place types can't be stored with a place, so 0047's triggers can't learn from
// Google candidates. Instead the API records the user's signal with the type it has live:
// - Winners: from the server's own live read of the completed Pick (getPick).
// - Swipes and votes: the type comes back from the app, but only with a proof the server
//   issued when it showed that card (getPick): an HMAC over pick, place, user and type, with
//   a key that never leaves the server. So the app can't claim a type the place doesn't have.
// 0056_google_taste_signals.sql then checks the action really happened and takes its weight
// and time from the saved swipe, ballot or winner. Pure TypeScript: Web Crypto only.

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
  /** Server-only HMAC (base64url) used to prove a live type to its own later request. */
  signTaste?(message: string): Promise<string>;
}

/** A survey place type, or null for anything else (older apps send nothing). */
export function surveyType(value: unknown): string | null {
  return typeof value === 'string' && TASTE_TYPES.has(value) ? value : null;
}

/** What a proof covers: this type, for this place, in this Pick, for this user only. */
export function tasteProofMessage(userId: string, pickId: string, placeId: string, type: string) {
  return JSON.stringify(['wtw-taste-v1', userId, pickId, placeId, type]);
}

/** A proof for a live Google type, or null when this store can't sign. */
export async function proveTaste(
  store: TasteSignalStore,
  userId: string,
  pickId: string,
  placeId: string,
  type: string,
): Promise<string | null> {
  if (!store.signTaste || !surveyType(type)) return null;
  try {
    return await store.signTaste(tasteProofMessage(userId, pickId, placeId, type));
  } catch {
    return null;
  }
}

/** Constant-time string comparison, so a proof can't be guessed byte by byte. */
function sameString(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Records one signal. Swipes and votes need a valid proof for exactly this user, Pick, place
 * and type; winners come from the server's own read. Never throws: learning is optional and
 * must not fail the swipe, vote or read that triggered it. Returns whether it was sent.
 */
export async function recordGoogleTaste(
  store: TasteSignalStore,
  userId: string,
  pickId: string,
  placeId: unknown,
  kind: TasteSignalKind,
  type: unknown,
  proof?: unknown,
): Promise<boolean> {
  const t = surveyType(type);
  if (!t || typeof placeId !== 'string' || !placeId || !store.recordGoogleTaste) return false;
  try {
    if (kind !== 'winner') {
      const expected = await proveTaste(store, userId, pickId, placeId, t);
      if (!expected || typeof proof !== 'string' || !sameString(proof, expected)) return false;
    }
    await store.recordGoogleTaste(userId, pickId, placeId, kind, t);
    return true;
  } catch {
    return false;
  }
}

/** The optional `tasteType` and `tasteProof` an app sends with a swipe or vote body. */
export function bodyTaste(body: unknown): { type: unknown; proof: unknown } {
  const b =
    typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  return { type: b.tasteType, proof: b.tasteProof };
}

/**
 * An HMAC-SHA-256 signer keyed from a server secret. The key is derived for this purpose only,
 * so the secret itself is never used directly as a MAC key.
 */
export function createTasteSigner(secret: string): (message: string) => Promise<string> {
  const enc = new TextEncoder();
  const hmac = { name: 'HMAC', hash: 'SHA-256' } as const;
  let key: Promise<CryptoKey> | undefined;
  const derived = async () => {
    const base = await crypto.subtle.importKey('raw', enc.encode(secret), hmac, false, ['sign']);
    const bytes = await crypto.subtle.sign('HMAC', base, enc.encode('wtw-taste-proof-key-v1'));
    return crypto.subtle.importKey('raw', bytes, hmac, false, ['sign']);
  };
  return async (message) => {
    key ??= derived();
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await key, enc.encode(message)));
    let bin = '';
    for (const b of sig) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
}
