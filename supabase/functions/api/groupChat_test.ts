import { createApp } from './app.ts';
import { ApiError } from '../_shared/api/errors.ts';
import type { GroupChatStore, GroupMessage } from '../_shared/api/groupChat.ts';
const userId = '11111111-1111-4111-8111-111111111111';
const groupId = '22222222-2222-4222-8222-222222222222';
const message: GroupMessage = {
  id: '33333333-3333-4333-8333-333333333333',
  groupId,
  senderId: userId,
  body: 'Hello',
  senderName: 'Josh',
  senderUsername: 'josh',
  senderAvatarUrl: null,
  createdAt: '2026-11-02T12:00:00Z',
};
const equal = (a: unknown, b: unknown) => {
  if (JSON.stringify(a) !== JSON.stringify(b))
    throw new Error(`Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
};
function setup(overrides: Partial<GroupChatStore> = {}, signedIn = true) {
  const calls: unknown[] = [];
  const notifications: unknown[] = [];
  const store: GroupChatStore = {
    list: async (...args) => {
      calls.push(['list', ...args]);
      return [message];
    },
    send: async (...args) => {
      calls.push(['send', ...args]);
      return { message, recipientIds: [userId, 'other-member'] };
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
        notifications.push(args);
      },
    },
    groupChatStore: store,
    getUser: async () => {
      if (!signedIn) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in');
      return { id: userId };
    },
  } as unknown as Parameters<typeof createApp>[0]);
  return {
    app,
    calls,
    notifications,
    request: (method: string, body?: unknown) =>
      app.request(`/groups/${groupId}/messages`, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
  };
}
Deno.test(
  'group chat routes authenticate, derive sender, validate/filter text and notify through existing notifier',
  async () => {
    const { request, calls, notifications } = setup();
    const list = await request('GET');
    equal(list.status, 200);
    equal(list.headers.get('Cache-Control'), 'private, no-store');
    equal(await list.json(), { messages: [message] });
    const result = await request('POST', {
      body: ' Hello ',
      clientId: 'request-0001',
      senderId: 'attacker',
      groupId: 'other',
    });
    equal(result.status, 201);
    equal(await result.json(), message);
    equal(calls, [
      ['list', userId, groupId],
      ['send', userId, groupId, { body: 'Hello', clientId: 'request-0001' }],
    ]);
    equal(notifications, [
      [['other-member'], 'group_message', null, { groupId, messageId: message.id }],
    ]);
    for (const body of [
      { body: ' ', clientId: 'request-0001' },
      { body: 'a'.repeat(1001), clientId: 'request-0001' },
      { body: 'Hi', clientId: 'bad' },
      { body: 'fuck', clientId: 'request-0001' },
    ])
      equal((await request('POST', body)).status, 400);
    equal(calls.length, 2);
    const denied = setup({}, false);
    equal((await denied.request('GET')).status, 401);
    equal((await denied.request('POST', {})).status, 401);
    equal(denied.calls, []);
  },
);
Deno.test(
  'group chat preserves member denial, retry conflicts and unavailable database errors',
  async () => {
    for (const [status, code] of [
      [404, 'GROUP_NOT_FOUND'],
      [409, 'MESSAGE_CONFLICT'],
      [503, 'DATABASE_NOT_READY'],
    ] as const) {
      const fail = async (): Promise<never> => {
        throw new ApiError(status, code, 'Unavailable');
      };
      const { request, notifications } = setup({ list: fail, send: fail });
      equal((await request('GET')).status, status);
      equal((await request('POST', { body: 'Hello', clientId: 'request-0001' })).status, status);
      equal(notifications, []);
    }
  },
);
