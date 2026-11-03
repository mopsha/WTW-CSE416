import { ApiError } from '../_shared/api/errors.ts';
import type { GroupChatStore, GroupMessage } from '../_shared/api/groupChat.ts';
import { createServiceClient } from './serviceClient.ts';
export function createGroupChatStore(): GroupChatStore {
  async function rpc(action: string, userId: string, groupId: string, input = {}) {
    const { data, error } = await createServiceClient().rpc('group_chat', {
      p_action: action,
      p_user_id: userId,
      p_group_id: groupId,
      p_input: input,
    });
    if (error) {
      if (error.code === 'PT429')
        throw new ApiError(429, 'MESSAGE_RATE_LIMITED', 'Too many messages. Try again shortly.');
      if (error.code === 'PT404') throw new ApiError(404, 'GROUP_NOT_FOUND', 'Group not found');
      if (error.code === 'PT409')
        throw new ApiError(409, 'MESSAGE_CONFLICT', 'Retry ID already used for another message');
      if (error.code === 'PT400' || error.code === '23514')
        throw new ApiError(400, 'INVALID_INPUT', 'Invalid message');
      if (error.code === 'PGRST202' || error.code === '42P01')
        throw new ApiError(503, 'DATABASE_NOT_READY', 'Group chat is not installed');
      throw new Error('Group chat operation failed');
    }
    return data;
  }
  return {
    list: async (u, g) => (await rpc('list', u, g)) as GroupMessage[],
    send: async (u, g, input) =>
      (await rpc('send', u, g, input)) as { message: GroupMessage; recipientIds: string[] },
  };
}
