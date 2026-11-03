import { createApp } from './app.ts';
import { ApiError } from '../_shared/api/errors.ts';
import type { PastMovesStore } from '../_shared/api/pastMoves.ts';
const userId = '11111111-1111-4111-8111-111111111111';
const target = '22222222-2222-4222-8222-222222222222';
const group = '33333333-3333-4333-8333-333333333333';
function equal(a: unknown, b: unknown) {
  if (JSON.stringify(a) !== JSON.stringify(b))
    throw new Error(`Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function setup(override?: PastMovesStore['list'], signedIn = true) {
  const calls: unknown[] = [];
  const unexpected = new Proxy(
    {},
    {
      get() {
        throw new Error('Unexpected Pick write/provider operation');
      },
    },
  );
  const app = createApp({
    store: unexpected,
    lifecycleStore: unexpected,
    closingStore: unexpected,
    poolBuilder: unexpected,
    pastMovesStore: {
      list:
        override ??
        (async (...args) => {
          calls.push(args);
          return { visible: true, pastMoves: [] };
        }),
    },
    getUser: async () => {
      if (!signedIn) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in');
      return { id: userId };
    },
  } as unknown as Parameters<typeof createApp>[0]);
  return { app, calls };
}
Deno.test(
  'Past Moves profile subresources derive owner/viewer, validate IDs and never touch Pick/provider writes',
  async () => {
    const { app, calls } = setup();
    const owner = await app.request(`/me/past-moves?userId=${target}&groupId=${group}`);
    equal(owner.status, 200);
    equal(owner.headers.get('Cache-Control'), 'private, no-store');
    equal(await owner.json(), { visible: true, pastMoves: [] });
    equal((await app.request(`/users/${target}/past-moves`)).status, 200);
    equal(calls, [
      [userId, userId, group],
      [userId, target, null],
    ]);
    equal((await app.request('/users/bad-id/past-moves')).status, 400);
    equal((await app.request('/me/past-moves?groupId=bad')).status, 400);
    equal(calls.length, 2);
  },
);
Deno.test(
  'Past Moves preserve hidden profiles, authorization failures and unavailable migrations',
  async () => {
    const hidden = setup(async () => ({ visible: false, pastMoves: [] }));
    equal(await (await hidden.app.request(`/users/${target}/past-moves`)).json(), {
      visible: false,
      pastMoves: [],
    });
    for (const status of [404, 503] as const) {
      const { app } = setup(async () => {
        throw new ApiError(status, 'UNAVAILABLE', 'Unavailable');
      });
      equal((await app.request(`/users/${target}/past-moves`)).status, status);
    }
    const denied = setup(undefined, false);
    equal((await denied.app.request('/me/past-moves')).status, 401);
    equal((await denied.app.request(`/users/${target}/past-moves`)).status, 401);
    equal(denied.calls, []);
  },
);
