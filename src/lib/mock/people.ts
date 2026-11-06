import type { PersonIdentity } from '@shared/api/people.ts';
import { normalizeUsername } from '@shared/api/usernames.ts';
import { mockUserProfiles, mockAvatarRef } from './userProfiles';
import { mockBlocks, mockProfile } from './store';
import { MOCK_USER_ID } from './auth';
import { mockFriendRows, requestMockUsername } from './friends';

let bucket = 0;
let reads = 0;
let dailyReads: number[] = [];
let requestDay = 0;
let requests = 0;
function limited() {
  const minute = Math.floor(Date.now() / 60000);
  if (minute !== bucket) {
    bucket = minute;
    reads = 0;
  }
  dailyReads = dailyReads.filter((at) => at > Date.now() - 86400000);
  if (reads >= 30 || dailyReads.length >= 150) return true;
  reads++;
  dailyReads.push(Date.now());
  return false;
}
export function resetMockPeople() {
  bucket = 0;
  reads = 0;
  dailyReads = [];
  requestDay = 0;
  requests = 0;
}
export function mockPerson(id: string): PersonIdentity | null {
  const p = mockUserProfiles.get(id);
  if (!p?.username || mockBlocks.has(id)) return null;
  const row = mockFriendRows().find((r) => r.userId === id);
  return {
    userId: id,
    username: p.username,
    displayName: id === MOCK_USER_ID ? mockProfile.displayName : (row?.displayName ?? null),
    avatarRef: mockAvatarRef(MOCK_USER_ID, id),
    relationship:
      id === MOCK_USER_ID
        ? 'self'
        : row?.status === 'accepted'
          ? 'friends'
          : row?.direction === 'in'
            ? 'incoming'
            : row
              ? 'requested'
              : 'none',
  };
}
export function mockPeopleRoute(method: string, path: string, body: unknown) {
  if (method === 'GET' && (path.startsWith('/friends/search?') || path.startsWith('/people/'))) {
    if (limited())
      return {
        status: 429,
        body: {
          error: { code: 'RATE_LIMITED', message: 'Too many profile searches. Try again shortly.' },
        },
      };
    if (path.startsWith('/people/')) {
      const person = mockPerson(decodeURIComponent(path.slice('/people/'.length)));
      return person
        ? { status: 200, body: person }
        : {
            status: 404,
            body: { error: { code: 'PROFILE_NOT_FOUND', message: 'Profile unavailable' } },
          };
    }
    const q = normalizeUsername(new URLSearchParams(path.split('?')[1]).get('q'), true);
    return {
      status: 200,
      body: {
        people: [...mockUserProfiles.keys()]
          .filter((id) => id !== MOCK_USER_ID)
          .map(mockPerson)
          .filter((p): p is PersonIdentity => !!p && p.username.startsWith(q))
          .sort((a, b) => a.username.localeCompare(b.username))
          .slice(0, 10),
      },
    };
  }
  if (method === 'POST' && path === '/friends/username-requests') {
    const username = normalizeUsername((body as { username?: unknown } | null)?.username, true);
    const targetId = (body as { targetId?: unknown } | null)?.targetId;
    if (targetId === MOCK_USER_ID)
      return {
        status: 400,
        body: { error: { code: 'CANNOT_FRIEND_SELF', message: 'You cannot add yourself' } },
      };
    const target =
      typeof targetId === 'string' &&
      mockUserProfiles.get(targetId)?.username === username &&
      !mockBlocks.has(targetId)
        ? targetId
        : null;
    if (!target)
      return {
        status: 404,
        body: { error: { code: 'NOT_FOUND', message: 'Profile unavailable' } },
      };
    const previous = mockPerson(target)?.relationship;
    if (previous === 'friends' || previous === 'requested')
      return { status: 200, body: { status: 'sent', relationship: previous } };
    const day = Math.floor(Date.now() / 86400000);
    if (day !== requestDay) {
      requestDay = day;
      requests = 0;
    }
    if (requests >= 20)
      return {
        status: 429,
        body: { error: { code: 'RATE_LIMITED', message: 'Too many friend requests today' } },
      };
    requests++;
    requestMockUsername(target);
    return {
      status: 200,
      body: { status: 'sent', relationship: mockPerson(target)?.relationship },
    };
  }
  return null;
}
