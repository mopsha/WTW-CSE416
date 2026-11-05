import { createApp } from './app.ts';
import { ApiError } from '../_shared/api/errors.ts';
function assert(value: unknown): asserts value {
  if (!value) throw new Error('Assertion failed');
}
const viewer = 'a0360001-3333-4333-8333-333333333333';
const target = 'a0360002-3333-4333-8333-333333333333';
Deno.test(
  'username routes derive authenticated viewer, normalize queries and preserve request quotas',
  async () => {
    let auth = true,
      allowed = true,
      calls = 0,
      requested = 0;
    const app = createApp({
      store: {} as never,
      lifecycleStore: {} as never,
      poolBuilder: {} as never,
      closingStore: {} as never,
      getUser: async () => {
        if (!auth) throw new ApiError(401, 'UNAUTHORIZED', 'Sign in');
        return { id: viewer };
      },
      friendsStore: {
        list: async () => [],
        request: async () => {
          throw new Error('Email route invoked');
        },
        accept: async () => {},
        remove: async () => {},
        takeFriendRequestLimit: async () => allowed,
        search: async (id, q) => {
          assert(id === viewer && q === 'some_user');
          calls++;
          return [];
        },
        person: async (id, t) => {
          assert(id === viewer && t === target);
          return {
            userId: target,
            displayName: 'Some',
            username: 'some_user',
            relationship: 'none',
          };
        },
        requestUsername: async (id, q, targetId) => {
          assert(id === viewer && q === 'some_user' && targetId === target);
          requested++;
        },
      },
    });
    let r = await app.request('/friends/search?q=%40SOME_USER');
    assert(
      r.status === 200 && calls === 1 && r.headers.get('Cache-Control') === 'private, no-store',
    );
    r = await app.request('/friends/search?q=so');
    assert(r.status === 400 && calls === 1);
    r = await app.request(`/people/${target}`);
    assert(r.status === 200 && !JSON.stringify(await r.json()).includes('email'));
    r = await app.request('/friends/username-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: '@Some_User', targetId: target, userId: target }),
    });
    assert(r.status === 200 && requested === 1);
    allowed = false;
    r = await app.request('/friends/username-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'some_user', targetId: target }),
    });
    assert(r.status === 429 && requested === 1);
    auth = false;
    r = await app.request('/friends/search?q=some_user');
    assert(r.status === 401 && calls === 1);
    r = await app.request(`/people/${target}`);
    assert(r.status === 401);
  },
);

Deno.test('reserved metadata exception comes only from the verified owner profile', async () => {
  let stored = 'admin',
    writes = 0;
  const app = createApp({
    store: {} as never,
    lifecycleStore: {} as never,
    poolBuilder: {} as never,
    closingStore: {} as never,
    getUser: async () => ({ id: viewer }),
    userProfilesStore: {
      get: async (v, t) => {
        assert(v === viewer && t === viewer);
        return { username: stored } as never;
      },
      update: async (v, input) => {
        assert(v === viewer && input.username === 'admin' && input.shareMetadata === false);
        writes++;
        return { username: 'admin' } as never;
      },
    },
  });
  const send = (username: string) =>
    app.request('/me/details', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        shareMetadata: false,
        currentUsername: 'admin',
        userId: target,
      }),
    });
  assert((await send('@ADMIN')).status === 200 && writes === 1);
  assert((await send('support')).status === 400 && writes === 1);
  stored = 'ordinary';
  assert((await send('admin')).status === 400 && writes === 1);
});
