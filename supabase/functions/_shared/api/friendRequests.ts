// Friend-request hardening (Razin, M4), for #24's POST /friends/requests:
//   * the same response whether or not the email has a WTW account (or blocked you), so the
//     route can't be used to find out who uses WTW;
//   * at most 20 requests per user per day (rate_limit_take in 0014_invites_safety.sql).
// #24 calls requestFriendSafely from its route instead of its own requestFriend; see
// docs/api-integration.md ("Friend requests").

import { ApiError } from './errors.ts';

/** What every accepted request returns. The app says "If they're on WTW, they'll see it". */
export const FRIEND_REQUEST_SENT = { status: 'sent' } as const;

export interface FriendRequestStore {
  /** One unit of the 20-a-day limit; false when it's used up. */
  takeFriendRequestLimit(userId: string): Promise<boolean>;
  /**
   * 0008's friend_request. May throw ApiError 404 for an unknown email (#24's store does):
   * that is swallowed here. Other errors pass through.
   */
  request(userId: string, email: string): Promise<unknown>;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseFriendRequestEmail(body: unknown): string {
  const email =
    typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>).email
      : undefined;
  const trimmed = typeof email === 'string' ? email.trim() : '';
  if (trimmed.length > 254 || !EMAIL.test(trimmed)) {
    throw new ApiError(400, 'INVALID_INPUT', 'Expected an email address');
  }
  return trimmed;
}

export async function requestFriendSafely(
  store: FriendRequestStore,
  userId: string,
  body: unknown,
) {
  const email = parseFriendRequestEmail(body);
  if (!(await store.takeFriendRequestLimit(userId))) {
    throw new ApiError(429, 'RATE_LIMITED', 'That’s a lot of friend requests today. Try tomorrow.');
  }
  try {
    await store.request(userId, email);
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 404)) throw error;
  }
  return FRIEND_REQUEST_SENT;
}
