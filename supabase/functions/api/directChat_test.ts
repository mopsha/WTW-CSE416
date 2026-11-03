import { createApp } from './app.ts';
import { ApiError } from '../_shared/api/errors.ts';
import type { DirectChatStore, DirectMessage } from '../_shared/api/directChat.ts';
const me = '11111111-1111-4111-8111-111111111111';
const peer = '22222222-2222-4222-8222-222222222222';
const id = '33333333-3333-4333-8333-333333333333';
const conversation = {
  id,
  createdAt: '2026-11-02T12:00:00Z',
  peer: { id: peer, displayName: 'Friend', username: 'friend', avatarUrl: null },
};
const message: DirectMessage = {
  id: '44444444-4444-4444-8444-444444444444',
  conversationId: id,
  senderId: me,
  senderName: 'Josh',
  senderUsername: 'josh',
  senderAvatarUrl: null,
  body: 'Hello',
  createdAt: conversation.createdAt,
};
function equal(a: unknown, b: unknown) {
  if (JSON.stringify(a) !== JSON.stringify(b))
    throw new Error(`Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function setup(overrides: Partial<DirectChatStore> = {}, signedIn = true) {
  const calls: unknown[] = [];
  const notices: unknown[] = [];
  const store: DirectChatStore = {
    open: async (...args) => {
      calls.push(['open', ...args]);
      return conversation;
    },
    list: async (...args) => {
      calls.push(['list', ...args]);
      return { conversation, messages: [message] };
    },
    send: async (...args) => {
      calls.push(['send', ...args]);
      return { message, recipientId: peer };
    },
    ...overrides,
  };
  const unexpected = new Proxy(
    {},
    {
      get() {
        throw new Error('Unexpected Pick operation');
      },
    },
  );
  const app = createApp({
    store: unexpected,
    closingStore: unexpected,
    poolBuilder: unexpected,
    lifecycleStore: {
      notifier: async (...args: unknown[]) => {
        notices.push(args);
      },
    },
    directChatStore: store,
    getUser: async () => {
      if (!signedIn) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in');
      return { id: me };
    },
  } as unknown as Parameters<typeof createApp>[0]);
  const request = (method: string, path: string, body?: unknown) =>
    app.request(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  return { request, calls, notices };
}
Deno.test('DM routes derive viewer/sender, reuse validation and notify only the peer', async () => {
  const { request, calls, notices } = setup();
  equal(
    (await request('POST', '/conversations', { userId: peer, senderId: 'attacker' })).status,
    200,
  );
  const list = await request('GET', `/conversations/${id}/messages`);
  equal(list.status, 200);
  equal(list.headers.get('Cache-Control'), 'private, no-store');
  equal(await list.json(), { conversation, messages: [message] });
  const sent = await request('POST', `/conversations/${id}/messages`, {
    body: ' Hello ',
    clientId: 'request-0001',
    senderId: peer,
  });
  equal(sent.status, 201);
  equal(await sent.json(), message);
  equal(calls, [
    ['open', me, peer],
    ['list', me, id],
    ['send', me, id, { body: 'Hello', clientId: 'request-0001' }],
  ]);
  equal(notices, [[[peer], 'direct_message', null, { conversationId: id, messageId: message.id }]]);
  for (const body of [
    { body: ' ', clientId: 'request-0001' },
    { body: 'fuck', clientId: 'request-0001' },
    { body: 'a'.repeat(1001), clientId: 'request-0001' },
    { body: 'Hello', clientId: 'bad' },
  ])
    equal((await request('POST', `/conversations/${id}/messages`, body)).status, 400);
  equal((await request('POST', '/conversations', {})).status, 400);
  equal(calls.length, 3);
});
Deno.test(
  'DM routes authenticate before stores and preserve unavailable/conflict errors',
  async () => {
    const denied = setup({}, false);
    equal((await denied.request('POST', '/conversations', {})).status, 401);
    equal((await denied.request('GET', `/conversations/${id}/messages`)).status, 401);
    equal((await denied.request('POST', `/conversations/${id}/messages`, {})).status, 401);
    equal(denied.calls, []);
    for (const status of [404, 409, 429, 503] as const) {
      const fail = async (): Promise<never> => {
        throw new ApiError(status, 'UNAVAILABLE', 'Unavailable');
      };
      const { request, notices } = setup({ open: fail, list: fail, send: fail });
      equal((await request('POST', '/conversations', { userId: peer })).status, status);
      equal((await request('GET', `/conversations/${id}/messages`)).status, status);
      equal(
        (
          await request('POST', `/conversations/${id}/messages`, {
            body: 'Hello',
            clientId: 'request-0001',
          })
        ).status,
        status,
      );
      equal(notices, []);
    }
  },
);
