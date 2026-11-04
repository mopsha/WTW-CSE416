import { ApiError, errorResponse } from '@shared/api/errors.ts';
import { MESSAGE_LIMIT, parseMessage, type MessageInput } from '@shared/api/messages.ts';
import type { DirectConversation, DirectHistory, DirectMessage } from '@shared/api/directChat.ts';
import type { NotificationRow } from '@shared/api/notify.ts';
import { MOCK_USER_ID } from './auth';
import { mockFriendsList } from './friends';
import { mockProfile } from './store';
import { mockUserProfiles, mockAvatarRef } from './userProfiles';
type Conversation = { id: string; low: string; high: string; createdAt: string };
export const mockDirectConversations = new Map<string, Conversation>();
export const mockDirectMessages = new Map<string, DirectMessage & { clientId: string }>();
const notices = new Map<string, NotificationRow>();
const listeners = new Map<string, Set<() => void>>();
let sequence = 0;
export function resetMockDirectChat() {
  mockDirectConversations.clear();
  mockDirectMessages.clear();
  notices.clear();
}
function eligible(a: string, b: string) {
  const peer = a === MOCK_USER_ID ? b : b === MOCK_USER_ID ? a : null;
  if (!peer || a === b || !mockFriendsList().friends.some((f) => f.userId === peer))
    throw new ApiError(
      404,
      'CONVERSATION_UNAVAILABLE',
      'Conversation unavailable. Messaging requires a current, unblocked friendship.',
    );
}
function project(c: Conversation, viewer: string): DirectConversation {
  const peer = viewer === c.low ? c.high : c.low;
  const details = mockUserProfiles.get(peer);
  return {
    id: c.id,
    createdAt: c.createdAt,
    peer: {
      id: peer,
      displayName:
        peer === MOCK_USER_ID
          ? mockProfile.displayName
          : (mockFriendsList().friends.find((f) => f.userId === peer)?.displayName ?? null),
      username: details?.username ?? null,
      avatarUrl: details?.avatarUrl ?? null,
      avatarRef: mockAvatarRef(viewer, peer),
    },
  };
}
function access(userId: string, id: string) {
  const c = mockDirectConversations.get(id);
  if (!c || ![c.low, c.high].includes(userId))
    throw new ApiError(404, 'CONVERSATION_UNAVAILABLE', 'Conversation unavailable');
  eligible(c.low, c.high);
  return c;
}
export function openMockDirectConversation(userId: string, peer: string): DirectConversation {
  eligible(userId, peer);
  const [low, high] = [userId, peer].sort() as [string, string];
  let c = [...mockDirectConversations.values()].find((x) => x.low === low && x.high === high);
  if (!c) {
    c = { id: `mock-conversation-${++sequence}`, low, high, createdAt: new Date().toISOString() };
    mockDirectConversations.set(c.id, c);
  }
  return project(c, userId);
}
const projectMessage = (m: DirectMessage, viewer: string): DirectMessage => {
  const p = mockUserProfiles.get(m.senderId);
  return {
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    body: m.body,
    createdAt: m.createdAt,
    senderName:
      m.senderId === MOCK_USER_ID
        ? mockProfile.displayName
        : (mockFriendsList().friends.find((f) => f.userId === m.senderId)?.displayName ?? null),
    senderUsername: p?.username ?? null,
    senderAvatarUrl: p?.avatarUrl ?? null,
    senderAvatarRef: mockAvatarRef(viewer, m.senderId),
  };
};
export function listMockDirectMessages(userId: string, id: string): DirectHistory {
  const c = access(userId, id);
  const messages = [...mockDirectMessages.values()]
    .filter((m) => m.conversationId === id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    .slice(0, MESSAGE_LIMIT)
    .reverse()
    .map((m) => projectMessage(m, userId));
  return { conversation: project(c, userId), messages };
}
export function sendMockDirectMessage(userId: string, id: string, value: MessageInput) {
  const c = access(userId, id);
  const input = parseMessage(value);
  let m = [...mockDirectMessages.values()].find(
    (m) => m.senderId === userId && m.clientId === input.clientId,
  );
  if (m && (m.conversationId !== id || m.body !== input.body))
    throw new ApiError(409, 'MESSAGE_CONFLICT', 'Retry ID already used for another message');
  if (!m) {
    m = {
      id: `mock-direct-message-${String(++sequence).padStart(8, '0')}`,
      conversationId: id,
      senderId: userId,
      body: input.body,
      clientId: input.clientId,
      createdAt: new Date().toISOString(),
      senderName: null,
      senderUsername: null,
      senderAvatarUrl: null,
    };
    mockDirectMessages.set(m.id, m);
    for (const listener of listeners.get(id) ?? []) listener();
  }
  const recipientId = userId === c.low ? c.high : c.low;
  if (recipientId === MOCK_USER_ID && !notices.has(m.id))
    notices.set(m.id, {
      id: `direct-notice-${m.id}`,
      type: 'direct_message',
      pickId: null,
      payload: { conversationId: id, messageId: m.id },
      createdAt: m.createdAt,
      readAt: null,
    });
  return { message: projectMessage(m, userId), recipientId };
}
export function mockDirectNotices() {
  return [...notices.values()].filter((n) => mockDirectMessages.has(String(n.payload.messageId)));
}
export function subscribeMockDirectChat(id: string, change: () => void) {
  const set = listeners.get(id) ?? new Set();
  listeners.set(id, set);
  set.add(change);
  return () => {
    set.delete(change);
    if (!set.size) listeners.delete(id);
  };
}
export function handleMockDirectChat(method: string, path: string, body: unknown) {
  const match = /^\/conversations\/([^/]+)\/messages$/.exec(path);
  if (path !== '/conversations' && !match) return null;
  try {
    if (path === '/conversations' && method === 'POST') {
      const peer = (body as { userId?: unknown } | null)?.userId;
      if (typeof peer !== 'string' || !peer)
        throw new ApiError(400, 'INVALID_INPUT', 'Choose a friend');
      return { status: 200, body: openMockDirectConversation(MOCK_USER_ID, peer) };
    }
    if (match && method === 'GET')
      return {
        status: 200,
        body: listMockDirectMessages(MOCK_USER_ID, decodeURIComponent(match[1]!)),
      };
    if (match && method === 'POST')
      return {
        status: 201,
        body: sendMockDirectMessage(MOCK_USER_ID, decodeURIComponent(match[1]!), parseMessage(body))
          .message,
      };
    return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Route not found' } } };
  } catch (e) {
    return errorResponse(e);
  }
}
