import type { PersonIdentity } from '../_shared/api/people.ts';
import { ApiError } from '../_shared/api/errors.ts';
import type { FriendRequestResult, FriendRow, FriendsStore } from '../_shared/api/friends.ts';
import { takeFriendRequestLimit } from './friendRequestLimit.ts';
import { createServiceClient } from './serviceClient.ts';
import { avatarMetadata } from './avatarMetadata.ts';

function fail(error: { code?: string }): never {
  switch (error.code) {
    case 'PGRST202':
      throw new ApiError(503, 'DATABASE_NOT_READY', 'Friends are not installed');
    case 'PT400':
      throw new ApiError(400, 'CANNOT_FRIEND_SELF', 'You cannot add yourself');
    case 'PT404':
      throw new ApiError(404, 'NOT_FOUND', 'No WTW account matches that');
    case 'PT429':
      throw new ApiError(429, 'RATE_LIMITED', 'Too many profile searches. Try again shortly.');
    case 'PT403':
      throw new ApiError(403, 'FORBIDDEN', 'Your account is not ready yet; try again');
    default:
      throw new Error('Database operation failed');
  }
}

/** Service-role adapter for the friend_* RPCs in 0008_friendships.sql. */
export function createFriendsStore(): FriendsStore {
  async function peopleRpc(name: string, args: Record<string, unknown>, viewer: string) {
    const { data, error } = await createServiceClient().rpc(name, args);
    if (error) fail(error);
    if (data == null) throw new ApiError(404, 'PROFILE_NOT_FOUND', 'Profile unavailable');
    const rows = (Array.isArray(data) ? data : [data]) as PersonIdentity[];
    const refs = await avatarMetadata(
      viewer,
      rows.map((p) => p.userId),
    );
    return rows.map((p) => ({ ...p, avatarRef: refs[p.userId]?.avatarRef ?? null }));
  }
  return {
    search: (viewer, query) =>
      peopleRpc('username_search', { p_user_id: viewer, p_query: query }, viewer),
    person: async (viewer, target) =>
      (await peopleRpc('person_lookup', { p_user_id: viewer, p_target_id: target }, viewer))[0]!,
    async requestUsername(viewer, username, targetId) {
      const { error } = await createServiceClient().rpc('friend_request_username', {
        p_user_id: viewer,
        p_username: username,
        p_target_id: targetId,
      });
      if (error) fail(error);
    },
    takeFriendRequestLimit,
    async list(userId) {
      const { data, error } = await createServiceClient().rpc('friend_list', {
        p_user_id: userId,
      });
      if (error) fail(error);
      const rows = (data ?? []) as FriendRow[];
      const refs = await avatarMetadata(
        userId,
        rows.filter((r) => r.status === 'accepted').map((r) => r.userId),
      );
      return rows.map((row) => ({
        ...row,
        avatarRef: row.status === 'accepted' ? (refs[row.userId]?.avatarRef ?? null) : null,
      }));
    },
    async request(userId, email) {
      const { data, error } = await createServiceClient().rpc('friend_request', {
        p_user_id: userId,
        p_email: email,
      });
      if (error) {
        if (error.code === 'PT404') {
          throw new ApiError(404, 'USER_NOT_FOUND', 'No WTW account uses that email');
        }
        fail(error);
      }
      return data as FriendRequestResult;
    },
    async accept(userId, friendId) {
      const { error } = await createServiceClient().rpc('friend_accept', {
        p_user_id: userId,
        p_friend_id: friendId,
      });
      if (error) {
        if (error.code === 'PT404') {
          throw new ApiError(404, 'REQUEST_NOT_FOUND', 'That friend request is gone');
        }
        fail(error);
      }
    },
    async remove(userId, friendId) {
      const { error } = await createServiceClient().rpc('friend_remove', {
        p_user_id: userId,
        p_friend_id: friendId,
      });
      if (error) fail(error);
    },
  };
}
