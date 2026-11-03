import { ApiError } from '../_shared/api/errors.ts';
import type {
  DirectChatStore,
  DirectConversation,
  DirectHistory,
  DirectMessage,
} from '../_shared/api/directChat.ts';
import { createServiceClient } from './serviceClient.ts';
export function createDirectChatStore(): DirectChatStore {
  async function rpc(action: string, userId: string, targetId: string, input = {}) {
    const { data, error } = await createServiceClient().rpc('direct_chat', {
      p_action: action,
      p_user_id: userId,
      p_target_id: targetId,
      p_input: input,
    });
    if (error) {
      if (error.code === 'PT429')
        throw new ApiError(429, 'MESSAGE_RATE_LIMITED', 'Too many messages. Try again shortly.');
      if (error.code === 'PT404')
        throw new ApiError(
          404,
          'CONVERSATION_UNAVAILABLE',
          'Conversation unavailable. Messaging requires a current, unblocked friendship.',
        );
      if (error.code === 'PT409')
        throw new ApiError(409, 'MESSAGE_CONFLICT', 'Retry ID already used for another message');
      if (error.code === 'PT400' || error.code === '23514')
        throw new ApiError(400, 'INVALID_INPUT', 'Invalid message');
      if (error.code === 'PGRST202' || error.code === '42P01')
        throw new ApiError(503, 'DATABASE_NOT_READY', 'Direct messages are not installed');
      throw new Error('Direct message operation failed');
    }
    return data;
  }
  return {
    open: async (u, p) => (await rpc('open', u, p)) as DirectConversation,
    list: async (u, c) => (await rpc('list', u, c)) as DirectHistory,
    send: async (u, c, input) =>
      (await rpc('send', u, c, input)) as { message: DirectMessage; recipientId: string },
  };
}
