import { ApiError } from './errors.ts';
import { requireCleanText } from './text.ts';
import type { Notifier } from './notify.ts';

export const GROUP_MESSAGE_MAX = 1000;
export const GROUP_MESSAGE_LIMIT = 50;
export interface GroupMessage {
  id: string;
  groupId: string;
  senderId: string;
  senderName: string | null;
  senderUsername: string | null;
  senderAvatarUrl: string | null;
  body: string;
  createdAt: string;
}
export interface GroupMessageInput {
  body: string;
  clientId: string;
}
export interface GroupChatStore {
  list(userId: string, groupId: string): Promise<GroupMessage[]>;
  send(
    userId: string,
    groupId: string,
    input: GroupMessageInput,
  ): Promise<{
    message: GroupMessage;
    recipientIds: string[];
  }>;
}
/** clientId identifies a send attempt across network retries; it conveys no authority. */
export function parseGroupMessage(value: unknown): GroupMessageInput {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ApiError(400, 'INVALID_INPUT', 'Expected a message');
  const input = value as Record<string, unknown>;
  if (typeof input.body !== 'string') throw new ApiError(400, 'INVALID_INPUT', 'Enter a message');
  const body = input.body.trim();
  if (
    !body ||
    [...body].length > GROUP_MESSAGE_MAX ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(body)
  )
    throw new ApiError(400, 'INVALID_INPUT', `Message must be 1–${GROUP_MESSAGE_MAX} characters`);
  if (
    typeof input.clientId !== 'string' ||
    input.clientId.trim() !== input.clientId ||
    !/^[a-zA-Z0-9_-]{8,100}$/.test(input.clientId)
  )
    throw new ApiError(400, 'INVALID_INPUT', 'A valid message retry ID is required');
  requireCleanText(body, 'message');
  return { body, clientId: input.clientId };
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
