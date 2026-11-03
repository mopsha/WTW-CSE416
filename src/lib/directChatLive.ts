import { createMessageLive } from './messageLive';
import { subscribeMockDirectChat } from './mock/directChat';
export const directChatLive = createMessageLive(
  'direct_messages',
  'conversation_id',
  subscribeMockDirectChat,
);
