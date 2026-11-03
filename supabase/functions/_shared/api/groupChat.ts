import {
  parseMessage as parseGroupMessage,
  type MessageInput as GroupMessageInput,
  type Message,
} from './messages.ts';
import type { Notifier } from './notify.ts';
export {
  MESSAGE_MAX as GROUP_MESSAGE_MAX,
  MESSAGE_LIMIT as GROUP_MESSAGE_LIMIT,
  parseMessage as parseGroupMessage,
} from './messages.ts';
export type { MessageInput as GroupMessageInput } from './messages.ts';
export interface GroupMessage extends Message {
  groupId: string;
}
export interface GroupChatStore {
  list(userId: string, groupId: string): Promise<GroupMessage[]>;
  send(
    userId: string,
    groupId: string,
    input: GroupMessageInput,
  ): Promise<{ message: GroupMessage; recipientIds: string[] }>;
}
export async function sendGroupMessage(
  store: GroupChatStore,
  notify: Notifier | undefined,
  userId: string,
  groupId: string,
  body: unknown,
) {
  const { message, recipientIds } = await store.send(userId, groupId, parseGroupMessage(body));
  // notify_insert deduplicates per message and rechecks membership/blocking at delivery time.
  await notify?.(
    recipientIds.filter((id) => id !== userId),
    'group_message',
    null,
    { groupId, messageId: message.id },
  );
  return message;
}
