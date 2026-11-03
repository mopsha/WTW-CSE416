import { createMessageLive } from './messageLive';
import { subscribeMockGroupChat } from './mock/groupChat';
export const groupChatLive = createMessageLive(
  'group_messages',
  'group_id',
  subscribeMockGroupChat,
);
