// Joining a Pick by code (Razin, M3). POST /picks/join { code } -> { pickId }.
// Which Picks accept new people (draft, swiping) is enforced atomically by
// pick_join in 0006_join_codes.sql; this layer validates input only.

import { ApiError } from './errors.ts';
import { parseJoinCode } from '../domain/joinCode.ts';

/** Database adapter. Rejects unknown/expired codes (404) and closed Picks (409). */
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
