import { requireCleanText } from './text.ts';
import { ApiError } from './errors.ts';
// New claims only; existing accounts are never silently renamed.
export const RESERVED_USERNAMES = [
  'admin',
  'administrator',
  'support',
  'moderator',
  'wtw',
  'official',
  'system',
];
export function normalizeUsername(
  value: unknown,
  search = false,
  currentUsername?: string | null,
): string {
  const username = typeof value === 'string' ? value.trim().replace(/^@/, '').toLowerCase() : '';
  if (!/^[a-z0-9_]{3,24}$/.test(username))
    throw new ApiError(
      400,
      'INVALID_INPUT',
      'Username must be 3–24 letters, numbers or underscores',
    );
  if (!search) requireCleanText(username, 'username');
  if (!search && RESERVED_USERNAMES.includes(username) && username !== currentUsername)
    throw new ApiError(400, 'INVALID_INPUT', 'That username is reserved');
  return username;
}
