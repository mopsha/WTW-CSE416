import { createApp } from './app.ts';
import { ApiError } from '../_shared/api/errors.ts';
import type { GroupIdea, GroupIdeasStore } from '../_shared/api/groupIdeas.ts';
// Test only Ideas routes: any accidental call into Pick/lifecycle throws.
const userId = '11111111-1111-4111-8111-111111111111';
const groupId = '22222222-2222-4222-8222-222222222222';
const ideaId = '33333333-3333-4333-8333-333333333333';
const input = { name: 'Catan', category: 'activity' as const };
const idea: GroupIdea = {
  ...input,
  id: ideaId,
  groupId,
  createdBy: userId,
  description: null,
  locationText: null,
  createdAt: '2026-11-02T12:00:00Z',
  updatedAt: '2026-11-02T12:00:00Z',
};
function assert(value: unknown, message = 'Assertion failed'): asserts value {
  if (!value) throw new Error(message);
}
function setup(overrides: Partial<GroupIdeasStore> = {}, signedIn = true) {
  const calls: unknown[][] = [];
  const store: GroupIdeasStore = {
    list: async (...args) => {
      calls.push(['list', ...args]);
      return [idea];
    },
    get: async (...args) => {
      calls.push(['get', ...args]);
      return idea;
    },
    create: async (...args) => {
      calls.push(['create', ...args]);
      return idea;
    },
    update: async (...args) => {
      calls.push(['update', ...args]);
      return idea;
    },
    delete: async (...args) => {
      calls.push(['delete', ...args]);
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
    getUser: async () => {
      if (!signedIn) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in');
      return { id: userId };
    },
    groupIdeasStore: store,
    store: unexpected,
    lifecycleStore: unexpected,
    poolBuilder: unexpected,
    closingStore: unexpected,
  } as unknown as Parameters<typeof createApp>[0]);
  const request = (method: string, suffix = '', body?: unknown) =>
    app.request(`/groups/${groupId}/ideas${suffix}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { app, calls, request };
}
Deno.test('Ideas CRUD routes derive caller identity and preserve response shapes', async () => {
  const { request, calls } = setup();
  const list = await request('GET');
  assert(list.headers.get('Cache-Control') === 'private, no-store');
  assert(JSON.stringify(await list.json()) === JSON.stringify({ ideas: [idea] }));
  assert((await request('GET', `/${ideaId}`)).status === 200);
  assert(
    (await request('POST', '', { ...input, createdBy: 'attacker', groupId: 'other' })).status ===
      201,
  );
  assert((await request('POST', `/${ideaId}`, input)).status === 200);
  assert((await request('DELETE', `/${ideaId}`)).status === 200);
  assert(calls.length === 5);
  assert(calls.every((c) => c[1] === userId && c[2] === groupId));
  assert(
    JSON.stringify(calls[2][3]) ===
      JSON.stringify({ ...input, description: null, locationText: null }),
  );
});
Deno.test(
  'Ideas reject anonymous, malformed/moderated inputs and malformed IDs before writes',
  async () => {
    const anon = setup({}, false);
    assert((await anon.request('POST', '', input)).status === 401);
    const { app, request, calls } = setup();
    for (const body of [
      null,
      { ...input, name: '' },
      { ...input, category: 'custom' },
      { ...input, description: 'fuck' },
    ])
      assert((await request('POST', '', body)).status === 400);
    assert((await request('GET', '/bad-id')).status === 400);
    assert((await app.request('/groups/bad-id/ideas')).status === 400);
    assert(calls.length === 0);
  },
);
Deno.test(
  'Ideas propagate membership/ownership failures without leaking rows or changing Picks',
  async () => {
    for (const status of [403, 404] as const) {
      const deny = async () => {
        throw new ApiError(status, status === 403 ? 'FORBIDDEN' : 'NOT_FOUND', 'Unavailable');
      };
      const { request } = setup({
        list: deny,
        get: deny,
        create: deny,
        update: deny,
        delete: deny,
      });
      for (const [method, suffix, body] of [
        ['GET', '', undefined],
        ['GET', `/${ideaId}`, undefined],
        ['POST', '', input],
        ['POST', `/${ideaId}`, input],
        ['DELETE', `/${ideaId}`, undefined],
      ] as const)
        assert((await request(method, suffix, body)).status === status);
    }
  },
);
