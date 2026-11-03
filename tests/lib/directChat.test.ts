import { createApiClient } from '@/lib/api';
import { MOCK_ACCESS_TOKEN, MOCK_USER_ID } from '@/lib/mock/auth';
import { mockFetch, MOCK_API_BASE_URL } from '@/lib/mock/api';
import { resetMockFriends } from '@/lib/mock/friends';
import { mockBlocks } from '@/lib/mock/store';
import {
  resetMockDirectChat,
  openMockDirectConversation,
  listMockDirectMessages,
  sendMockDirectMessage,
  mockDirectConversations,
  mockDirectMessages,
} from '@/lib/mock/directChat';
import { inboxRoute } from '@/lib/inbox';
const api = createApiClient({
  baseUrl: MOCK_API_BASE_URL,
  getAccessToken: async () => MOCK_ACCESS_TOKEN,
  fetch: mockFetch,
});
beforeEach(() => {
  resetMockDirectChat();
  resetMockFriends();
  mockBlocks.clear();
});
test('both pair directions and repeated opens reuse exactly one accepted-friend conversation', async () => {
  const first = await api.openDirectConversation('mock-ava');
  expect(openMockDirectConversation('mock-ava', MOCK_USER_ID).id).toBe(first.id);
  expect((await api.openDirectConversation('mock-ava')).id).toBe(first.id);
  expect(mockDirectConversations.size).toBe(1);
  expect(first.peer.id).toBe('mock-ava');
  for (const user of [MOCK_USER_ID, 'mock-jordan', 'stranger'])
    await expect(api.openDirectConversation(user)).rejects.toMatchObject({ status: 404 });
});
test('authenticated sender, shared validation and retry dedup match group chat', async () => {
  const c = await api.openDirectConversation('mock-ava');
  const m = await api.sendDirectMessage(c.id, {
    body: ' Hello ',
    clientId: 'request-0001',
    senderId: 'mock-ava',
  } as Parameters<typeof api.sendDirectMessage>[1]);
  expect(m).toMatchObject({ senderId: MOCK_USER_ID, conversationId: c.id, body: 'Hello' });
  expect((await api.sendDirectMessage(c.id, { body: 'Hello', clientId: 'request-0001' })).id).toBe(
    m.id,
  );
  expect(mockDirectMessages.size).toBe(1);
  await expect(
    api.sendDirectMessage(c.id, { body: 'Changed', clientId: 'request-0001' }),
  ).rejects.toMatchObject({ status: 409 });
  for (const body of [' ', 'a'.repeat(1001), 'fuck'])
    await expect(
      api.sendDirectMessage(c.id, { body, clientId: 'request-0002' }),
    ).rejects.toMatchObject({ status: 400 });
  expect((await api.listDirectMessages(c.id)).messages).toHaveLength(1);
  expect(() => listMockDirectMessages('mock-ben', c.id)).toThrow();
});
test('unfriend preserves data but revokes reading/sending; block and unblock do not restore friendship', async () => {
  const c = await api.openDirectConversation('mock-ava');
  await api.sendDirectMessage(c.id, { body: 'History', clientId: 'request-0001' });
  await api.removeFriend('mock-ava');
  await expect(api.listDirectMessages(c.id)).rejects.toMatchObject({ status: 404 });
  await expect(
    api.sendDirectMessage(c.id, { body: 'No', clientId: 'request-0002' }),
  ).rejects.toMatchObject({ status: 404 });
  expect(mockDirectMessages.size).toBe(1);
  resetMockFriends();
  expect((await api.openDirectConversation('mock-ava')).id).toBe(c.id);
  await api.blockUser('mock-ava');
  expect(() => listMockDirectMessages('mock-ava', c.id)).toThrow();
  expect(() =>
    sendMockDirectMessage('mock-ava', c.id, { body: 'No', clientId: 'request-0002' }),
  ).toThrow();
  await api.unblockUser('mock-ava');
  await expect(api.listDirectMessages(c.id)).rejects.toMatchObject({ status: 404 });
});
test('recipient-only inbox notices are generic, correctly routed and deduplicated; blocks prevent new notices', async () => {
  const c = await api.openDirectConversation('mock-ava');
  await api.sendDirectMessage(c.id, { body: 'Own message', clientId: 'request-0001' });
  expect(
    (await api.listNotifications()).notifications.filter((n) => n.type === 'direct_message'),
  ).toEqual([]);
  const input = { body: 'Private words', clientId: 'request-0002' };
  sendMockDirectMessage('mock-ava', c.id, input);
  sendMockDirectMessage('mock-ava', c.id, input);
  const notices = (await api.listNotifications()).notifications.filter(
    (n) => n.type === 'direct_message',
  );
  expect(notices).toHaveLength(1);
  expect(JSON.stringify(notices)).not.toContain(input.body);
  expect(inboxRoute(notices[0]!)).toBe(`/messages/${c.id}`);
  mockBlocks.add('mock-ava');
  expect(() =>
    sendMockDirectMessage('mock-ava', c.id, { body: 'Blocked', clientId: 'request-0003' }),
  ).toThrow();
  expect(
    (await api.listNotifications()).notifications.filter((n) => n.type === 'direct_message'),
  ).toHaveLength(1);
});
test('latest 50 chronological messages and account-deletion cascades', async () => {
  const c = await api.openDirectConversation('mock-ava');
  for (let i = 0; i < 55; i++) {
    const { message } = sendMockDirectMessage(MOCK_USER_ID, c.id, {
      body: String(i),
      clientId: `history-${String(i).padStart(4, '0')}`,
    });
    mockDirectMessages.get(message.id)!.createdAt = new Date(1000 + i).toISOString();
  }
  const history = await api.listDirectMessages(c.id);
  expect(history.messages).toHaveLength(50);
  expect(history.messages[0]!.body).toBe('5');
  expect(history.messages[49]!.body).toBe('54');
  await api.deleteMe();
  expect(mockDirectConversations.size).toBe(0);
  expect(mockDirectMessages.size).toBe(0);
  await expect(api.listDirectMessages(c.id)).rejects.toMatchObject({ status: 404 });
});
