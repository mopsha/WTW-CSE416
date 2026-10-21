// Friends (Mike, M3). One row per pair in public.friendships (0008_friendships.sql):
//   GET  /friends                 -> { friends, incoming, outgoing }
//   POST /friends/requests        { email } -> { userId, displayName, status }
//   POST /friends/:userId/accept  -> { status: 'accepted' }
//   POST /friends/:userId/remove  -> { status: 'ok' }  (decline, cancel, or unfriend)
// The RPCs enforce who may do what atomically; this layer validates input and
// shapes the list. Nobody's email is ever returned.

import { ApiError } from './errors.ts';

export type FriendStatus = 'pending' | 'accepted';

/** One friend_list row: the other person, and which way the request went. */
export interface FriendRow {
  userId: string;
  displayName: string | null;
  status: FriendStatus;
  direction: 'in' | 'out';
  createdAt: string;
  acceptedAt: string | null;
}

export interface FriendPerson {
  userId: string;
  displayName: string | null;
  /** When they became friends (friends) or when the request was sent (requests). */
  since: string;
}

export interface FriendsList {
  friends: FriendPerson[];
  incoming: FriendPerson[];
  outgoing: FriendPerson[];
}

export interface FriendRequestResult {
  userId: string;
  displayName: string | null;
  /** 'accepted' when they had already asked you, or you were already friends. */
  status: FriendStatus;
}

/** Database adapter. Rejects unknown emails (404), yourself (400), and missing requests (404). */
export interface FriendsStore {
  list(userId: string): Promise<FriendRow[]>;
  request(userId: string, email: string): Promise<FriendRequestResult>;
  accept(userId: string, friendId: string): Promise<void>;
  remove(userId: string, friendId: string): Promise<void>;
}

// Deliberately loose: the database does an exact (case-insensitive) match, so this only
// keeps obvious junk and huge strings away from it.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseFriendRequest(body: unknown): string {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ApiError(400, 'INVALID_INPUT', 'Expected a friend request object');
  }
  const { email } = body as Record<string, unknown>;
  const trimmed = typeof email === 'string' ? email.trim() : '';
  if (trimmed.length > 254 || !EMAIL.test(trimmed)) {
    throw new ApiError(400, 'INVALID_INPUT', 'Expected an email address');
  }
  return trimmed.toLowerCase();
}

export function parseFriendId(id: string): string {
  if (!UUID.test(id)) throw new ApiError(400, 'INVALID_INPUT', 'Expected a user id');
  return id.toLowerCase();
}

/** Friends, requests to me, and requests I sent, each newest first. */
export function groupFriends(rows: readonly FriendRow[]): FriendsList {
  const person = (r: FriendRow): FriendPerson => ({
    userId: r.userId,
    displayName: r.displayName,
    since: r.status === 'accepted' ? (r.acceptedAt ?? r.createdAt) : r.createdAt,
  });
  const newest = (a: FriendPerson, b: FriendPerson) => b.since.localeCompare(a.since);
  return {
    friends: rows
      .filter((r) => r.status === 'accepted')
      .map(person)
      .sort(newest),
    incoming: rows
      .filter((r) => r.status === 'pending' && r.direction === 'in')
      .map(person)
      .sort(newest),
    outgoing: rows
      .filter((r) => r.status === 'pending' && r.direction === 'out')
      .map(person)
      .sort(newest),
  };
}

export async function listFriends(store: FriendsStore, userId: string): Promise<FriendsList> {
  return groupFriends(await store.list(userId));
}

export async function requestFriend(
  store: FriendsStore,
  userId: string,
  body: unknown,
): Promise<FriendRequestResult> {
  return store.request(userId, parseFriendRequest(body));
}

export async function acceptFriend(store: FriendsStore, userId: string, friendId: string) {
  await store.accept(userId, parseFriendId(friendId));
  return { status: 'accepted' as const };
}

export async function removeFriend(store: FriendsStore, userId: string, friendId: string) {
  await store.remove(userId, parseFriendId(friendId));
  return { status: 'ok' as const };
}
