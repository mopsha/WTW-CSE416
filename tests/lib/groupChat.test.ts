import { parseGroupMessage, GROUP_MESSAGE_MAX } from '@shared/api/groupChat.ts';
import { createApiClient } from '@/lib/api';
import { MOCK_ACCESS_TOKEN, MOCK_USER_ID } from '@/lib/mock/auth';
import { MOCK_API_BASE_URL, mockFetch } from '@/lib/mock/api';
import { mockGroupRecord, resetMockGroups } from '@/lib/mock/groups';
import {
  mockGroupMessages,
  listMockGroupMessages,
  sendMockGroupMessage,
} from '@/lib/mock/groupChat';
import { mockBlocks, resetMockProfile } from '@/lib/mock/store';
import { inboxRoute } from '@/lib/inbox';
const groupId = 'mock-group-roommates';
const api = createApiClient({
  baseUrl: MOCK_API_BASE_URL,
  getAccessToken: async () => MOCK_ACCESS_TOKEN,
  fetch: mockFetch,
});
beforeEach(() => {
  resetMockGroups();
  resetMockProfile();
  mockBlocks.clear();
});
test('message validation trims, accepts multiline/code points and rejects empty/oversized/control/filtered text', () => {
  expect(
    parseGroupMessage({ body: ' Hello\nworld ', clientId: 'request-0001', senderId: 'other' }),
  ).toEqual({ body: 'Hello\nworld', clientId: 'request-0001' });
  expect(
    parseGroupMessage({ body: '🔥'.repeat(GROUP_MESSAGE_MAX), clientId: 'request-0001' }).body,
  ).toHaveLength(GROUP_MESSAGE_MAX * 2);
  for (const body of [
    null,
    {},
    { body: ' ', clientId: 'request-0001' },
    { body: 'a'.repeat(1001), clientId: 'request-0001' },
    { body: '\u0000', clientId: 'request-0001' },
    { body: 'Hello', clientId: 'bad' },
    { body: 'fuck', clientId: 'request-0001' },
  ])
    expect(() => parseGroupMessage(body)).toThrow();
});
test('API sender is the caller; retries reuse one row and a changed body with the same ID conflicts', async () => {
  const message = await api.sendGroupMessage(groupId, {
    body: ' Hi ',
    clientId: 'request-0001',
    senderId: 'mock-ava',
  } as Parameters<typeof api.sendGroupMessage>[1]);
  expect(message).toMatchObject({ senderId: MOCK_USER_ID, body: 'Hi', groupId });
  expect((await api.sendGroupMessage(groupId, { body: 'Hi', clientId: 'request-0001' })).id).toBe(
    message.id,
  );
  expect(mockGroupMessages.size).toBe(1);
  await expect(
    api.sendGroupMessage(groupId, { body: 'Different', clientId: 'request-0001' }),
  ).rejects.toMatchObject({ status: 409 });
  expect((await api.listGroupMessages(groupId)).messages).toHaveLength(1);
});
test('pending invitees and nonmembers cannot read or send', async () => {
  for (const id of ['mock-group-weekend', 'missing']) {
    await expect(api.listGroupMessages(id)).rejects.toMatchObject({ status: 404 });
    await expect(
      api.sendGroupMessage(id, { body: 'Hi', clientId: 'request-0001' }),
    ).rejects.toMatchObject({ status: 404 });
  }
});
test('blocking hides both directions and excludes notification recipients; notifications contain no message text', async () => {
  sendMockGroupMessage('mock-ava', groupId, {
    body: 'Private group text',
    clientId: 'request-0001',
  });
  const inbox = await api.listNotifications();
  const chat = inbox.notifications.filter((n) => n.type === 'group_message');
  expect(chat).toHaveLength(1);
  expect(JSON.stringify(chat)).not.toContain('Private group text');
  expect(inboxRoute(chat[0]!)).toBe(`/groups/${groupId}?section=chat`);
  sendMockGroupMessage('mock-ava', groupId, {
    body: 'Private group text',
    clientId: 'request-0001',
  });
  expect(
    (await api.listNotifications()).notifications.filter((n) => n.type === 'group_message'),
  ).toHaveLength(1);
  mockBlocks.add('mock-ava');
  expect((await api.listGroupMessages(groupId)).messages).toEqual([]);
  // Existing generic notices stay in the inbox, like the real backend; new blocked sends do not notify.
  sendMockGroupMessage('mock-ava', groupId, { body: 'After block', clientId: 'request-0002' });
  expect(
    (await api.listNotifications()).notifications.filter((n) => n.type === 'group_message'),
  ).toHaveLength(1);
  const own = sendMockGroupMessage(MOCK_USER_ID, groupId, {
    body: 'Own text',
    clientId: 'request-0002',
  });
  expect(own.recipientIds).not.toContain('mock-ava');
  expect(listMockGroupMessages('mock-ava', groupId)).toHaveLength(2); // Ava sees only her own text.
});
test('removal revokes reads/writes and preserves history for remaining members; leaving is equivalent', async () => {
  const g = mockGroupRecord(groupId)!;
  sendMockGroupMessage('mock-ben', groupId, { body: 'History', clientId: 'request-0001' });
  await api.removeGroupMember(groupId, 'mock-ben');
  expect(listMockGroupMessages(MOCK_USER_ID, groupId)).toHaveLength(1);
  expect(() => listMockGroupMessages('mock-ben', groupId)).toThrow();
  expect(() =>
    sendMockGroupMessage('mock-ben', groupId, { body: 'No', clientId: 'request-0002' }),
  ).toThrow();
  expect(g.memberIds).not.toContain('mock-ben');
  await api.leaveGroup('mock-group-climbing');
  await expect(api.listGroupMessages('mock-group-climbing')).rejects.toMatchObject({ status: 404 });
});
test('only the latest 50 are returned, deterministically chronological', () => {
  for (let i = 0; i < 55; i++) {
    const { message } = sendMockGroupMessage(MOCK_USER_ID, groupId, {
      body: String(i),
      clientId: `request-${String(i).padStart(4, '0')}`,
    });
    mockGroupMessages.get(message.id)!.createdAt = new Date(1_000 + i).toISOString();
  }
  const result = listMockGroupMessages(MOCK_USER_ID, groupId);
  expect(result).toHaveLength(50);
  expect(result[0]!.body).toBe('5');
  expect(result[49]!.body).toBe('54');
});
test('group deletion cascades messages and account deletion clears authored/group-owned content', async () => {
  await api.sendGroupMessage(groupId, { body: 'Hello', clientId: 'request-0001' });
  await api.deleteGroup(groupId);
  expect(mockGroupMessages.size).toBe(0);
  resetMockGroups();
  await api.sendGroupMessage('mock-group-climbing', {
    body: 'My content',
    clientId: 'request-0002',
  });
  sendMockGroupMessage('mock-ava', 'mock-group-climbing', {
    body: 'Other content',
    clientId: 'request-0003',
  });
  await api.deleteMe();
  expect([...mockGroupMessages.values()].map((m) => m.body)).toEqual(['Other content']);
});
