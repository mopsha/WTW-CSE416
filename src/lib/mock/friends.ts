// Friends for mock mode: the same routes, shapes and error codes as the API's /friends
// (supabase/functions/_shared/api/friends.ts), backed by an in-memory list. Ava, Ben and Cam
// (the bots from the Pick demo, same ids) are already friends, and Jordan has sent a request
// so Accept/Decline can be shown. Resets with the app, or via resetMockFriends().
import { groupFriends, type FriendRow, type FriendsList } from '@shared/api/friends.ts';

import { FRIENDS } from '@/components/theme';
import { mockBlocks } from './store';

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

export function mockFriendsList(): FriendsList {
  return groupFriends(rows.filter((row) => !mockBlocks.has(row.userId)));
}

/**
 * Routes /friends requests. `body` is the parsed JSON (undefined if it didn't parse).
 * Returns null for paths that aren't friends routes.
 */
export function handleMockFriends(
  method: string,
  path: string,
  body: unknown,
  _myEmail: string | null,
): Result | null {
  if (method === 'GET' && path === '/friends') return ok(mockFriendsList());

  if (method === 'POST' && path === '/friends/requests') {
    return fail(410, 'EMAIL_REQUESTS_RETIRED', 'Find friends by username instead');
  }

  const match = /^\/friends\/([^/]+)\/(accept|remove)$/.exec(path);
  if (method !== 'POST' || !match) return null;
  const userId = decodeURIComponent(match[1] ?? '');
  const row = rows.find((r) => r.userId === userId);

  if (match[2] === 'accept') {
    if (!row || row.direction !== 'in' || mockBlocks.has(userId)) {
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

/** Shared fixture graph; username discovery does not create a second friendship store. */
export const mockFriendRows = () => rows;
export function requestMockUsername(userId: string) {
  const row = rows.find((r) => r.userId === userId);
  if (row) {
    if (row.status === 'pending' && row.direction === 'in') {
      row.status = 'accepted';
      row.acceptedAt = new Date().toISOString();
    }
    return;
  }
  rows.push({
    userId,
    displayName: null,
    status: 'pending',
    direction: 'out',
    createdAt: new Date().toISOString(),
    acceptedAt: null,
  });
}
