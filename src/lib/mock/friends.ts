// Friends for mock mode: the same routes, shapes and error codes as the API's /friends
// (supabase/functions/_shared/api/friends.ts), backed by an in-memory list. Ava, Ben and Cam
// (the bots from the Pick demo, same ids) are already friends, and Jordan has sent a request
// so Accept/Decline can be shown. Resets with the app, or via resetMockFriends().
import {
  groupFriends,
  parseFriendRequest,
  type FriendRow,
  type FriendsList,
} from '@shared/api/friends.ts';

import { FRIENDS } from '@/components/theme';

/** Mock mode: emails starting with this have no account (to show the 404). */
export const MOCK_UNKNOWN_EMAIL_PREFIX = 'nobody@';

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

function initial(): FriendRow[] {
  return [
    ...FRIENDS.map((f, i): FriendRow => ({
      userId: `mock-${f.name.toLowerCase()}`,
      displayName: f.name,
      status: 'accepted',
      direction: i === 0 ? 'in' : 'out',
      createdAt: ago(60 * 24 * (10 + i)),
      acceptedAt: ago(60 * 24 * (9 + i)),
    })),
    {
      userId: 'mock-jordan',
      displayName: 'Jordan',
      status: 'pending',
      direction: 'in',
      createdAt: ago(45),
      acceptedAt: null,
    },
  ];
}

let rows = initial();

export function resetMockFriends() {
  rows = initial();
}

type Result = { status: number; body: unknown };
const ok = (body: unknown): Result => ({ status: 200, body });
const fail = (status: number, code: string, message: string): Result => ({
  status,
  body: { error: { code, message } },
});

/** "dana.lee@x.com" -> "Dana" (the mock has no real profiles to read a name from). */
function nameFromEmail(email: string): string {
  const word = (email.split('@')[0] ?? '').split(/[^a-zA-Z]/)[0] ?? '';
  return word ? word[0]!.toUpperCase() + word.slice(1) : 'New friend';
}

export function mockFriendsList(): FriendsList {
  return groupFriends(rows);
}

/**
 * Routes /friends requests. `body` is the parsed JSON (undefined if it didn't parse).
 * Returns null for paths that aren't friends routes.
 */
export function handleMockFriends(
  method: string,
  path: string,
  body: unknown,
  myEmail: string | null,
): Result | null {
  if (method === 'GET' && path === '/friends') return ok(mockFriendsList());

  if (method === 'POST' && path === '/friends/requests') {
    if (body === undefined) return fail(400, 'INVALID_JSON', 'Request body must be valid JSON');
    let email: string;
    try {
      email = parseFriendRequest(body);
    } catch {
      return fail(400, 'INVALID_INPUT', 'Expected an email address');
    }
    if (myEmail && email === myEmail.toLowerCase()) {
      return fail(400, 'CANNOT_FRIEND_SELF', 'You cannot add yourself');
    }
    if (email.startsWith(MOCK_UNKNOWN_EMAIL_PREFIX)) {
      // Like the API: the same answer whether or not the email has an account.
      return ok({ status: 'sent' });
    }
    const displayName = nameFromEmail(email);
    const userId = `mock-${email}`;
    const existing = rows.find((r) => r.userId === userId);
    if (existing) {
      if (existing.status === 'pending' && existing.direction === 'in') {
        existing.status = 'accepted';
        existing.acceptedAt = new Date().toISOString();
      }
      return ok({ status: 'sent' });
    }
    rows.push({
      userId,
      displayName,
      status: 'pending',
      direction: 'out',
      createdAt: new Date().toISOString(),
      acceptedAt: null,
    });
    return ok({ status: 'sent' });
  }

  const match = /^\/friends\/([^/]+)\/(accept|remove)$/.exec(path);
  if (method !== 'POST' || !match) return null;
  const userId = decodeURIComponent(match[1] ?? '');
  const row = rows.find((r) => r.userId === userId);

  if (match[2] === 'accept') {
    if (!row || row.direction !== 'in') {
      return fail(404, 'REQUEST_NOT_FOUND', 'That friend request is gone');
    }
    if (row.status === 'pending') {
      row.status = 'accepted';
      row.acceptedAt = new Date().toISOString();
    }
    return ok({ status: 'accepted' });
  }
  rows = rows.filter((r) => r.userId !== userId);
  return ok({ status: 'ok' });
}
