// The caller's own profile (Razin's Week 2 "what should we call you?" step).
// POST /me { displayName } -> { displayName }. The route always writes the
// verified caller's row; there is no way to name someone else.

import { ApiError } from './errors.ts';

/** profiles.display_name check in 0001_init.sql: char_length between 1 and 50. */
export const DISPLAY_NAME_MAX = 50;

/** Database adapter. Sets display_name on the caller's profile row. */
export interface ProfileStore {
  setDisplayName(userId: string, displayName: string): Promise<void>;
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
  return result.name;
}

export async function updateMe(store: ProfileStore, userId: string, body: unknown) {
  const displayName = parseProfileUpdate(body);
  await store.setDisplayName(userId, displayName);
  return { displayName };
}
