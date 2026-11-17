// The caller's own profile (Razin's Week 2 "what should we call you?" step, and the
// onboarding survey, FR-02).
// GET /me -> { displayName, preferences, onboarded }
// POST /me { displayName } -> { displayName }
// POST /me/preferences { preferences } -> { preferences, onboarded: true }
// GET /me/learned-taste -> { learned: [{ type, score }] }, strongest first, decayed to now
// DELETE /me/learned-taste -> { status: 'ok' } ("Reset what WTW learned")
// Every route reads or writes the verified caller's row; there is no way to touch someone else's.

import { readPreferences, validatePreferences, type Preferences } from '../domain/preferences.ts';
import { decayedScore, TASTE_TYPES } from '../domain/groupTaste.ts';
import { ApiError } from './errors.ts';
import { requireCleanText } from './text.ts';

/** profiles.display_name check in 0001_init.sql: char_length between 1 and 50. */
export const DISPLAY_NAME_MAX = 50;

/** Database adapter for the caller's profile row. */
export interface ProfileStore {
  finishOptionalSetup?(userId: string): Promise<void>;
  setDisplayName(userId: string, displayName: string): Promise<void>;
  /** null when the row doesn't exist. preferences is the raw stored jsonb. */
  getProfile(userId: string): Promise<{
    birthdayRequired?: boolean;
    username?: string | null;
    optionalSetupPending?: boolean;
    displayName: string | null;
    preferences: unknown;
    preferencesUpdatedAt: string | null;
  } | null>;
  /** Saves the survey and stamps preferences_updated_at (which means "onboarded"). */
  setPreferences(userId: string, preferences: Preferences): Promise<void>;
  /** Raw learned_taste rows (0047_taste_learning.sql). */
  learnedTaste?(
    userId: string,
  ): Promise<{ place_type: string; score: number; updated_at: string }[]>;
  resetLearnedTaste?(userId: string): Promise<void>;
}

/** Below this (after decay) a learned score is too faint to mention. */
export const LEARNED_VISIBLE = 0.5;

export interface LearnedTaste {
  /** A survey place type, e.g. "thai_restaurant". */
  type: string;
  /** Decayed score, -10 to 10; positive means likes. */
  score: number;
}

function requireLearning(store: ProfileStore) {
  if (!store.learnedTaste || !store.resetLearnedTaste)
    throw new ApiError(503, 'NOT_CONFIGURED', 'Taste learning is not available');
  return { read: store.learnedTaste, reset: store.resetLearnedTaste };
}

/** What WTW has learned about me, strongest first; faint and unknown types are left out. */
export async function getLearnedTaste(
  store: ProfileStore,
  userId: string,
  now = new Date(),
): Promise<{ learned: LearnedTaste[] }> {
  const rows = await requireLearning(store).read.call(store, userId);
  const learned = rows
    .filter((r) => TASTE_TYPES.has(r.place_type))
    .map((r) => ({ type: r.place_type, score: decayedScore(r.score, r.updated_at, now) }))
    .filter((r) => Math.abs(r.score) >= LEARNED_VISIBLE)
    .sort((a, b) => b.score - a.score || (a.type < b.type ? -1 : 1));
  return { learned };
}

export async function resetLearnedTaste(store: ProfileStore, userId: string) {
  await requireLearning(store).reset.call(store, userId);
  return { status: 'ok' as const };
}

export interface MeResponse {
  birthdayRequired?: boolean;
  username: string | null;
  optionalSetupPending: boolean;
  displayName: string | null;
  preferences: Preferences;
  /** True once the survey was saved or skipped. */
  onboarded: boolean;
}

/**
 * Trimmed display name, or an error message. Length counts characters the way
 * Postgres char_length does (code points), so an emoji is one, not two.
 */
export function validateDisplayName(value: unknown): { name: string } | { error: string } {
  if (typeof value !== 'string') return { error: 'Enter a name' };
  const name = value.trim();
  if (!name) return { error: 'Enter a name' };
  const chars = [...name];
  // Control characters (newlines, tabs, NUL...) would break every list the name appears in.
  if (chars.some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)) {
    return { error: 'Use one line, no special characters' };
  }
  if (chars.length > DISPLAY_NAME_MAX) {
    return { error: `Keep it to ${DISPLAY_NAME_MAX} characters or fewer` };
  }
  return { name };
}

export function parseProfileUpdate(body: unknown): string {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ApiError(400, 'INVALID_INPUT', 'Expected a profile object');
  }
  const result = validateDisplayName((body as Record<string, unknown>).displayName);
  if ('error' in result) throw new ApiError(400, 'INVALID_INPUT', result.error);
  requireCleanText(result.name, 'name');
  return result.name;
}

export async function updateMe(store: ProfileStore, userId: string, body: unknown) {
  const displayName = parseProfileUpdate(body);
  await store.setDisplayName(userId, displayName);
  return { displayName };
}

export async function getMe(store: ProfileStore, userId: string): Promise<MeResponse> {
  const row = await store.getProfile(userId);
  return {
    ...(row?.birthdayRequired ? { birthdayRequired: true } : {}),
    username: row?.username ?? null,
    optionalSetupPending: row?.optionalSetupPending ?? false,
    displayName: row?.displayName?.trim() || null,
    preferences: readPreferences(row?.preferences),
    onboarded: !!row?.preferencesUpdatedAt,
  };
}

export function parsePreferencesUpdate(body: unknown): Preferences {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ApiError(400, 'INVALID_INPUT', 'Expected a preferences object');
  }
  const result = validatePreferences((body as Record<string, unknown>).preferences);
  if ('error' in result) throw new ApiError(400, 'INVALID_INPUT', result.error);
  return result.preferences;
}

/** Saving, even all-empty answers (the "Skip" button), marks onboarding done. */
export async function updatePreferences(store: ProfileStore, userId: string, body: unknown) {
  const preferences = parsePreferencesUpdate(body);
  await store.setPreferences(userId, preferences);
  return { preferences, onboarded: true };
}
