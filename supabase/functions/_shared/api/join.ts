// Joining a Pick by code (Razin, M3). POST /picks/join { code } -> { pickId }.
// Which Picks accept new people (draft or swiping, not locked, not full, host hasn't blocked
// you) is enforced atomically by pick_join in 0014_invites_safety.sql; this layer validates
// input only. Every "no" is the same 404, so codes can't be probed (M4).

import { ApiError } from './errors.ts';
import { parseJoinCode } from '../domain/joinCode.ts';

/** Every way a code can fail: unknown, expired, closed, locked, full or blocked. */
export const JOIN_CODE_NOT_FOUND = new ApiError(
  404,
  'JOIN_CODE_NOT_FOUND',
  'That code isn’t valid, or the Pick isn’t taking new people',
);
/** After 10 failed joins (by code or invite link) in an hour. */
export const JOIN_RATE_LIMITED = new ApiError(
  429,
  'RATE_LIMITED',
  'Too many tries. Wait a bit before trying another code.',
);

/** Database adapter. Throws JOIN_CODE_NOT_FOUND or JOIN_RATE_LIMITED. */
export interface JoinStore {
  joinByCode(code: string, userId: string): Promise<string>;
}

export function parseJoin(body: unknown): string {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ApiError(400, 'INVALID_INPUT', 'Expected a join object');
  }
  const { code } = body as Record<string, unknown>;
  const parsed = typeof code === 'string' && code.length <= 64 ? parseJoinCode(code) : null;
  if (!parsed) throw new ApiError(400, 'INVALID_INPUT', 'Expected a 6-character join code');
  return parsed;
}

export async function joinPick(store: JoinStore, userId: string, body: unknown) {
  const code = parseJoin(body);
  return { pickId: await store.joinByCode(code, userId) };
}
