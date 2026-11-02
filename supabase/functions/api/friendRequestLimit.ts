import { rpcError } from './rpcErrors.ts';
import { createServiceClient } from './serviceClient.ts';

/**
 * The 20-a-day friend request limit (rate_limit_take in 0014), for requestFriendSafely.
 * #24 wires it with its own store: { takeFriendRequestLimit, request: friendsStore.request }.
 */
export async function takeFriendRequestLimit(userId: string): Promise<boolean> {
  const { data, error } = await createServiceClient().rpc('rate_limit_take', {
    p_user_id: userId,
    p_action: 'friend_request',
  });
  if (error) rpcError(error);
  return data === true;
}
