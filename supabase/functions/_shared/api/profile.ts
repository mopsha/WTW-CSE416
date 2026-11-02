// The caller's own profile (Razin's Week 2 "what should we call you?" step, and the
// onboarding survey, FR-02).
// GET /me -> { displayName, preferences, onboarded }
// POST /me { displayName } -> { displayName }
// POST /me/preferences { preferences } -> { preferences, onboarded: true }
// Every route reads or writes the verified caller's row; there is no way to touch someone else's.

import { readPreferences, validatePreferences, type Preferences } from '../domain/preferences.ts';
import { ApiError } from './errors.ts';
import { requireCleanText } from './text.ts';

/** profiles.display_name check in 0001_init.sql: char_length between 1 and 50. */
export const DISPLAY_NAME_MAX = 50;

/** Database adapter for the caller's profile row. */
export interface ProfileStore {
  setDisplayName(userId: string, displayName: string): Promise<void>;
  /** null when the row doesn't exist. preferences is the raw stored jsonb. */
  getProfile(userId: string): Promise<{
    displayName: string | null;
    preferences: unknown;
    preferencesUpdatedAt: string | null;
  } | null>;
  /** Saves the survey and stamps preferences_updated_at (which means "onboarded"). */
  setPreferences(userId: string, preferences: Preferences): Promise<void>;
}

export interface MeResponse {
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
