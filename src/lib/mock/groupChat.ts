import type { NotificationRow } from '@shared/api/notify.ts';
import { ApiError, errorResponse } from '@shared/api/errors.ts';
import {
  GROUP_MESSAGE_LIMIT,
  parseGroupMessage,
  type GroupMessage,
  type GroupMessageInput,
} from '@shared/api/groupChat.ts';
import { MOCK_USER_ID } from './auth';
import { mockGroupRecord, mockGroupPersonName } from './groups';
import { mockBlocks, mockProfile } from './store';
import { mockUserProfiles, mockAvatarRef } from './userProfiles';

export const mockGroupMessages = new Map<string, GroupMessage & { clientId: string }>();
let sequence = 0;
const notices = new Map<string, NotificationRow>();
export function resetMockGroupChat() {
  mockGroupMessages.clear();
  notices.clear();
}
export function mockGroupChatNotices() {
  return [...notices.values()].filter((notice) => {
    const m = mockGroupMessages.get(String(notice.payload.messageId));
    // Like real notification FKs, delete notices with messages; old generic notices
    // remain harmless after membership/block changes and never contain chat text.
    return !!m;
  });
}
const listeners = new Map<string, Set<() => void>>();
export function subscribeMockGroupChat(groupId: string, change: () => void) {
  const set = listeners.get(groupId) ?? new Set();
  listeners.set(groupId, set);
  set.add(change);
  return () => {
    set.delete(change);
    if (!set.size) listeners.delete(groupId);
  };
}
const blocked = (a: string, b: string) =>
  (a === MOCK_USER_ID && mockBlocks.has(b)) || (b === MOCK_USER_ID && mockBlocks.has(a));
function membership(userId: string, groupId: string) {
  const group = mockGroupRecord(groupId);
  if (!group?.memberIds.includes(userId))
    throw new ApiError(404, 'GROUP_NOT_FOUND', 'Group not found');
  return group;
}
const project = (m: GroupMessage, viewer: string): GroupMessage => {
  const details = mockUserProfiles.get(m.senderId);
  return {
    id: m.id,
    groupId: m.groupId,
    senderId: m.senderId,
    body: m.body,
    createdAt: m.createdAt,
    senderName:
      m.senderId === MOCK_USER_ID ? mockProfile.displayName : mockGroupPersonName(m.senderId),
    senderUsername: details?.username ?? null,
    senderAvatarUrl: details?.avatarUrl ?? null,
    senderAvatarRef: mockAvatarRef(viewer, m.senderId),
  };
};
export function listMockGroupMessages(userId: string, groupId: string): GroupMessage[] {
  membership(userId, groupId);
  return [...mockGroupMessages.values()]
    .filter((m) => m.groupId === groupId && !blocked(userId, m.senderId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    .slice(0, GROUP_MESSAGE_LIMIT)
    .reverse()
    .map((m) => project(m, userId));
}
export function sendMockGroupMessage(userId: string, groupId: string, value: GroupMessageInput) {
  const group = membership(userId, groupId);
  const input = parseGroupMessage(value);
  let message = [...mockGroupMessages.values()].find(
    (m) => m.senderId === userId && m.clientId === input.clientId,
  );
  if (message && (message.groupId !== groupId || message.body !== input.body))
    throw new ApiError(409, 'MESSAGE_CONFLICT', 'Retry ID already used for another message');
  if (!message) {
    message = {
      id: `mock-message-${String(++sequence).padStart(8, '0')}`,
      groupId,
      senderId: userId,
      body: input.body,
      clientId: input.clientId,
      createdAt: new Date().toISOString(),
      senderName: null,
      senderUsername: null,
      senderAvatarUrl: null,
    };
    mockGroupMessages.set(message.id, message);
    for (const listener of listeners.get(groupId) ?? []) listener();
  }
  const recipientIds = group.memberIds.filter((u) => u !== userId && !blocked(u, userId));
  if (recipientIds.includes(MOCK_USER_ID) && !notices.has(message.id))
    notices.set(message.id, {
      id: `chat-notice-${message.id}`,
      type: 'group_message',
      pickId: null,
      payload: { groupId, messageId: message.id },
      createdAt: message.createdAt,
      readAt: null,
    });
  return { message: project(message, userId), recipientIds };
}
export function handleMockGroupChat(method: string, path: string, body: unknown) {
  const match = /^\/groups\/([^/]+)\/messages$/.exec(path);
  if (!match) return null;
  try {
    const id = decodeURIComponent(match[1]!);
    if (method === 'GET')
      return { status: 200, body: { messages: listMockGroupMessages(MOCK_USER_ID, id) } };
    if (method === 'POST')
      return {
        status: 201,
        body: sendMockGroupMessage(MOCK_USER_ID, id, parseGroupMessage(body)).message,
      };
    return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Route not found' } } };
  } catch (e) {
    return errorResponse(e);
  }
}
