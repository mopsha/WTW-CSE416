import { ApiError } from '../_shared/api/errors.ts';
import type { FriendRequestResult, FriendRow, FriendsStore } from '../_shared/api/friends.ts';
import { createServiceClient } from './serviceClient.ts';

function fail(error: { code?: string }): never {
  switch (error.code) {
    case 'PGRST202':
      throw new ApiError(503, 'DATABASE_NOT_READY', 'Friends are not installed');
    case 'PT400':
      throw new ApiError(400, 'CANNOT_FRIEND_SELF', 'You cannot add yourself');
    case 'PT404':
      throw new ApiError(404, 'NOT_FOUND', 'No WTW account matches that');
    case 'PT403':
      throw new ApiError(403, 'FORBIDDEN', 'Your account is not ready yet; try again');
    default:
      throw new Error('Database operation failed');
  }
}

/** Service-role adapter for the friend_* RPCs in 0008_friendships.sql. */
export function createFriendsStore(): FriendsStore {
  return {
    async list(userId) {
      const { data, error } = await createServiceClient().rpc('friend_list', {
        p_user_id: userId,
      });
      if (error) fail(error);
      return (data ?? []) as FriendRow[];
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
