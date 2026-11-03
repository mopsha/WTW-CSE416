import { parseMessage, type Message, type MessageInput } from './messages.ts';
import type { Notifier } from './notify.ts';
export interface DirectConversation {
  id: string;
  createdAt: string;
  peer: {
    id: string;
    displayName: string | null;
    username: string | null;
    avatarUrl: string | null;
  };
}
export interface DirectMessage extends Message {
  conversationId: string;
}
export interface DirectHistory {
  conversation: DirectConversation;
  messages: DirectMessage[];
}
export interface DirectChatStore {
  open(userId: string, peerId: string): Promise<DirectConversation>;
  list(userId: string, conversationId: string): Promise<DirectHistory>;
  send(
    userId: string,
    conversationId: string,
    input: MessageInput,
  ): Promise<{ message: DirectMessage; recipientId: string }>;
}
export async function sendDirectMessage(
  store: DirectChatStore,
  notify: Notifier | undefined,
  userId: string,
  conversationId: string,
  body: unknown,
) {
  const { message, recipientId } = await store.send(userId, conversationId, parseMessage(body));
  await notify?.(recipientId === userId ? [] : [recipientId], 'direct_message', null, {
    conversationId,
    messageId: message.id,
  });
  return message;
}
