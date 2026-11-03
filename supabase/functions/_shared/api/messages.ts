import { ApiError } from './errors.ts';
import { requireCleanText } from './text.ts';
export const MESSAGE_MAX = 1000;
export const MESSAGE_LIMIT = 50;
export interface MessageInput {
  body: string;
  clientId: string;
}
export interface Message {
  id: string;
  senderId: string;
  senderName: string | null;
  senderUsername: string | null;
  senderAvatarUrl: string | null;
  body: string;
  createdAt: string;
}
/** clientId identifies a send attempt across network retries; it conveys no authority. */
export function parseMessage(value: unknown): MessageInput {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ApiError(400, 'INVALID_INPUT', 'Expected a message');
  const input = value as Record<string, unknown>;
  if (typeof input.body !== 'string') throw new ApiError(400, 'INVALID_INPUT', 'Enter a message');
  const body = input.body.trim();
  if (
    !body ||
    [...body].length > MESSAGE_MAX ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(body)
  )
    throw new ApiError(400, 'INVALID_INPUT', `Message must be 1–${MESSAGE_MAX} characters`);
  if (
    typeof input.clientId !== 'string' ||
    input.clientId.trim() !== input.clientId ||
    !/^[a-zA-Z0-9_-]{8,100}$/.test(input.clientId)
  )
    throw new ApiError(400, 'INVALID_INPUT', 'A valid message retry ID is required');
  requireCleanText(body, 'message');
  return { body, clientId: input.clientId };
}
