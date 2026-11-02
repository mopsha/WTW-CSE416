import { createApp } from './app.ts';
import { ApiError } from '../_shared/api/errors.ts';
import type { HeartbeatStore } from '../_shared/api/heartbeat.ts';
import type { LifecycleStore } from '../_shared/api/lifecycle.ts';
import type { ClosingStore } from '../_shared/api/closing.ts';
import type { VotingStore } from '../_shared/api/voting.ts';
import type { PoolBuilder } from '../_shared/places/pool.ts';
import type { FriendsStore } from '../_shared/api/friends.ts';
import type { NotifyStore } from '../_shared/api/notify.ts';
import type { GroupsStore } from '../_shared/api/groups.ts';
import type { PlansStore } from '../_shared/api/plans.ts';
import type { SafetyStore } from '../_shared/api/safety.ts';
import { INVITE_NOT_FOUND, type InviteStore } from '../_shared/api/invites.ts';
import { JOIN_CODE_NOT_FOUND, JOIN_RATE_LIMITED } from '../_shared/api/join.ts';

const store: HeartbeatStore = {
  loadPick: async () => null,
  upsertSwipe: async () => {
    throw new Error('Unexpected write');
  },
  saveRanking: async () => {
    throw new Error('Unexpected write');
  },
};
const lifecycleStore: LifecycleStore = {
  createPick: async () => {
    throw new Error('Unexpected write');
  },
  load: async () => null,
  start: async () => {
    throw new Error('Unexpected write');
  },
  refresh: async () => {
    throw new Error('Unexpected write');
  },
  cancel: async () => {
    throw new Error('Unexpected write');
  },
};
const poolBuilder: PoolBuilder = {
  buildPool: async () => {
    throw new Error('Unexpected pool build');
  },
};
const closingStore: ClosingStore & VotingStore = {
  loadForClose: async () => null,
  applyClose: async () => {
    throw new Error('Unexpected write');
  },
  loadForVote: async () => null,
  castVote: async () => {
    throw new Error('Unexpected write');
  },
  applyVoteClose: async () => {
    throw new Error('Unexpected write');
  },
};
function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
Deno.test(
  'internal sweep rejects missing/wrong secrets before querying or user authentication',
  async () => {
    const app = createApp({
      store,
      lifecycleStore,
      poolBuilder,
      closingStore,
      cronSecret: 'test-only-secret',
      getUser: async () => {
        throw new Error('User auth must not run');
      },
      sweepStore: {
        expiredPage: async () => {
          throw new Error('Query must not run');
        },
      },
    });
    const rejectedHeaders: Record<string, string>[] = [
      {},
      { 'x-cron-secret': 'wrong' },
      { Authorization: 'Bearer user-token' },
    ];
    for (const headers of rejectedHeaders) {
      equal((await app.request('/internal/sweep', { method: 'POST', headers })).status, 401);
    }
  },
);

Deno.test('internal sweep with the correct secret executes at the Supabase mount', async () => {
  const phases: string[] = [];
  const app = createApp(
    {
      store,
      lifecycleStore,
      poolBuilder,
      closingStore,
      cronSecret: 'test-only-secret',
      getUser: async () => {
        throw new Error('User auth must not run');
      },
      sweepStore: {
        expiredPage: async (phase) => {
          phases.push(phase);
          return [];
        },
      },
    },
    '/api',
  );
  const response = await app.request('/api/internal/sweep', {
    method: 'POST',
    headers: { 'x-cron-secret': 'test-only-secret' },
  });
  equal(response.status, 200);
  equal((await response.json()).status, 'ok');
  equal(phases, ['swiping', 'final_vote']);
});

Deno.test('internal sweep fails closed without server configuration', async () => {
  const app = createApp({
    store,
    lifecycleStore,
    poolBuilder,
    closingStore,
    getUser: async () => {
      throw new Error('User auth must not run');
    },
  });
  equal(
    (
      await app.request('/internal/sweep', {
        method: 'POST',
        headers: { 'x-cron-secret': 'anything' },
      })
    ).status,
    503,
  );
});

Deno.test('internal sweep reports partial failure without returning query details', async () => {
  const app = createApp({
    store,
    lifecycleStore,
    poolBuilder,
    closingStore,
    cronSecret: 'test-only-secret',
    getUser: async () => {
      throw new Error('User auth must not run');
    },
    sweepStore: {
      expiredPage: async () => {
        throw new Error('private database details');
      },
    },
  });
  const response = await app.request('/internal/sweep', {
    method: 'POST',
    headers: { 'x-cron-secret': 'test-only-secret' },
  });
  equal(response.status, 503);
  const body = await response.json();
  equal(body.status, 'partial_failure');
  equal(body.swiping.queryFailed, true);
  equal(body.final_vote.queryFailed, true);
  equal(JSON.stringify(body).includes('private'), false);
});
Deno.test('public health and uniform 404', async () => {
  const app = createApp({
    store,
    lifecycleStore,
    poolBuilder,
    closingStore,
    getUser: async () => {
      throw new Error('Auth must not run');
    },
  });
  const health = await app.request('/health');
  equal(health.status, 200);
  equal(await health.json(), { status: 'ok' });
  equal((await app.request('/missing')).status, 404);
});
Deno.test('authentication failures are JSON 401', async () => {
  const app = createApp({
    store,
    lifecycleStore,
    poolBuilder,
    closingStore,
    getUser: async () => {
      throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in');
    },
  });
  const result = await app.request('/picks/p/rank', { method: 'POST' });
  equal(result.status, 401);
  equal(await result.json(), { error: { code: 'UNAUTHENTICATED', message: 'Sign in' } });
});
Deno.test('invalid JSON and missing Pick', async () => {
  const app = createApp({
    store,
    lifecycleStore,
    poolBuilder,
    closingStore,
    getUser: async () => ({ id: 'host' }),
  });
  equal((await app.request('/picks/p/swipes', { method: 'POST', body: '{' })).status, 400);
  equal((await app.request('/picks/p/rank', { method: 'POST' })).status, 404);
  equal((await app.request('/picks/p/refresh', { method: 'POST', body: '{' })).status, 400);
  equal((await app.request('/picks/p', { method: 'GET' })).status, 404);
  equal((await app.request('/picks/p/close', { method: 'POST' })).status, 404);
  equal((await app.request('/picks/p/vote', { method: 'POST', body: '{' })).status, 400);
  equal((await app.request('/picks/p/close-vote', { method: 'POST' })).status, 404);
});
Deno.test('preflight does not require authentication', async () => {
  const app = createApp({
    store,
    lifecycleStore,
    poolBuilder,
    closingStore,
    getUser: async () => {
      throw new Error('Unexpected auth');
    },
  });
  const response = await app.request('/picks/p/rank', {
    method: 'OPTIONS',
    headers: { Origin: 'http://localhost:8081' },
  });
  equal(response.status, 204);
});

Deno.test('Supabase mount retains health and JSON errors', async () => {
  const app = createApp(
    { store, lifecycleStore, poolBuilder, closingStore, getUser: async () => ({ id: 'host' }) },
    '/api',
  );
  equal(await (await app.request('/api/health')).json(), { status: 'ok' });
  const missing = await app.request('/api/unknown');
  equal(missing.status, 404);
  equal(await missing.json(), { error: { code: 'NOT_FOUND', message: 'Route not found' } });
});

Deno.test('POST /picks creates a draft Pick', async () => {
  const app = createApp({
    store,
    poolBuilder,
    closingStore,
    getUser: async () => ({ id: 'host' }),
    lifecycleStore: { ...lifecycleStore, createPick: async () => ({ id: 'new-pick' }) },
  });
  const result = await app.request('/picks', {
    method: 'POST',
    body: JSON.stringify({ category: 'food', center: { lat: 1, lng: 2 }, radiusM: 500 }),
    headers: { 'Content-Type': 'application/json' },
  });
  equal(result.status, 201);
  equal(await result.json(), { pickId: 'new-pick', state: 'draft' });
});

Deno.test('POST /picks/:id/start rejects a non-host with 403', async () => {
  const app = createApp({
    store,
    poolBuilder,
    closingStore,
    getUser: async () => ({ id: 'guest' }),
    lifecycleStore: {
      ...lifecycleStore,
      load: async () => ({
        id: 'pick',
        hostId: 'host',
        state: 'draft',
        category: 'food',
        center: { lat: 0, lng: 0 },
        radiusM: 500,
        poolSize: 20,
        deadlineAt: null,
        closeThreshold: 100,
        participantIds: ['host', 'guest'],
        candidates: [],
        hasAnswers: false,
        myAnswers: {},
        winnerPlaceId: null,
        decidedAt: null,
        decidedBy: null,
        version: '1',
      }),
    },
  });
  const result = await app.request('/picks/pick/start', { method: 'POST' });
  equal(result.status, 403);
});

Deno.test('POST /picks/:id/close rejects a non-host with 403', async () => {
  const app = createApp({
    store,
    lifecycleStore,
    poolBuilder,
    getUser: async () => ({ id: 'guest' }),
    closingStore: {
      ...closingStore,
      loadForClose: async () => ({
        id: 'pick',
        hostId: 'host',
        state: 'swiping',
        center: { lat: 0, lng: 0 },
        closeThreshold: 100,
        deadlineAt: null,
        participantIds: ['host', 'guest'],
        candidates: [],
        preferences: [],
        version: '1',
        winnerPlaceId: null,
        finalistIds: [],
      }),
    },
  });
  const result = await app.request('/picks/pick/close', { method: 'POST' });
  equal(result.status, 403);
});

Deno.test('POST /picks/:id/vote rejects a non-finalist with 400', async () => {
  const app = createApp({
    store,
    lifecycleStore,
    poolBuilder,
    getUser: async () => ({ id: 'host' }),
    closingStore: {
      ...closingStore,
      loadForVote: async () => ({
        id: 'pick',
        hostId: 'host',
        state: 'final_vote',
        participantIds: ['host', 'guest'],
        finalists: [{ placeId: 'a', rank: 1 }],
        ballots: [],
        voteDeadlineAt: null,
      }),
    },
  });
  const result = await app.request('/picks/pick/vote', {
    method: 'POST',
    body: JSON.stringify({ placeId: 'not-a-finalist' }),
    headers: { 'Content-Type': 'application/json' },
  });
  equal(result.status, 400);
});

Deno.test('a swipe triggers the auto-close check without failing the swipe', async () => {
  const closeChecks: string[] = [];
  const app = createApp({
    poolBuilder,
    lifecycleStore,
    getUser: async () => ({ id: 'host' }),
    store: {
      loadPick: async () => ({
        id: 'pick',
        hostId: 'host',
        state: 'swiping',
        center: { lat: 0, lng: 0 },
        participantIds: ['host'],
        candidates: [{ placeId: 'a', lat: 0, lng: 0 }],
        preferences: [],
        version: '1',
      }),
      upsertSwipe: async () => {},
      saveRanking: async () => {
        throw new Error('Unexpected write');
      },
    },
    closingStore: {
      ...closingStore,
      loadForClose: async () => {
        closeChecks.push('checked');
        return null; // not due; closePick('system', ...) returns null, no throw
      },
    },
  });
  const result = await app.request('/picks/pick/swipes', {
    method: 'POST',
    body: JSON.stringify({ placeId: 'a', value: 2 }),
    headers: { 'Content-Type': 'application/json' },
  });
  equal(result.status, 200);
  equal(await result.json(), { status: 'ok' });
  equal(closeChecks, ['checked']);
});

Deno.test('GET /picks/:id/progress: counts only, participants only', async () => {
  const progressStore = {
    loadProgress: async () => ({
      state: 'swiping' as const,
      hostId: 'host',
      deadlineAt: null,
      voteDeadlineAt: null,
      candidateCount: 2,
      participants: [
        {
          userId: 'me',
          displayName: 'Me',
          joinedAt: '2026-10-02T00:00:01Z',
          answered: 1,
          voted: false,
        },
        {
          userId: 'host',
          displayName: 'Host',
          joinedAt: '2026-10-02T00:00:00Z',
          answered: 2,
          voted: false,
        },
      ],
    }),
  };
  const as = (id: string) =>
    createApp({
      store,
      lifecycleStore,
      poolBuilder,
      closingStore,
      progressStore,
      getUser: async () => ({ id }),
    });
  const ok = await as('me').request('/picks/p/progress');
  equal(ok.status, 200);
  const body = await ok.json();
  equal(body.doneCount, 1);
  equal(
    body.participants.map((p: { userId: string; done: boolean }) => [p.userId, p.done]),
    [
      ['host', true],
      ['me', false],
    ],
  );
  equal(JSON.stringify(body).includes('answered'), false);
  equal((await as('stranger').request('/picks/p/progress')).status, 403);
});

Deno.test('POST /picks/join: 401 without a token', async () => {
  const joined: string[] = [];
  const app = createApp({
    store,
    lifecycleStore,
    poolBuilder,
    closingStore,
    joinStore: {
      joinByCode: async (code) => {
        joined.push(code);
        return 'pick';
      },
    },
    getUser: async (req) => {
      if (!req.headers.get('Authorization')) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in');
      return { id: 'guest' };
    },
  });
  const result = await app.request('/picks/join', {
    method: 'POST',
    body: JSON.stringify({ code: 'K7P2QX' }),
    headers: { 'Content-Type': 'application/json' },
  });
  equal(result.status, 401);
  equal(await result.json(), { error: { code: 'UNAUTHENTICATED', message: 'Sign in' } });
  equal(joined, []);
});

Deno.test('POST /picks/join: 400 for bad input, before touching the database', async () => {
  const app = createApp({
    store,
    lifecycleStore,
    poolBuilder,
    closingStore,
    joinStore: {
      joinByCode: async () => {
        throw new Error('Unexpected join');
      },
    },
    getUser: async () => ({ id: 'guest' }),
  });
  const post = (body: string) =>
    app.request('/picks/join', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json' },
    });
  for (const body of [
    '{',
    '',
    '[]',
    '{}',
    JSON.stringify({ code: 123456 }),
    JSON.stringify({ code: 'K7P2Q' }),
    JSON.stringify({ code: 'K7P2QXX' }),
    JSON.stringify({ code: 'O0I1AB' }),
    JSON.stringify({ code: 'K7P2Q!' }),
  ]) {
    const result = await post(body);
    equal(result.status, 400);
  }
});

Deno.test('POST /picks/join: joins with a normalized code and returns the Pick id', async () => {
  const calls: [string, string][] = [];
  const app = createApp({
    store,
    lifecycleStore,
    poolBuilder,
    closingStore,
    joinStore: {
      joinByCode: async (code, userId) => {
        calls.push([code, userId]);
        return 'pick-1';
      },
    },
    getUser: async () => ({ id: 'guest' }),
  });
  const result = await app.request('/picks/join', {
    method: 'POST',
    body: JSON.stringify({ code: ' k7p 2qx ' }),
    headers: { 'Content-Type': 'application/json' },
  });
  equal(result.status, 200);
  equal(await result.json(), { pickId: 'pick-1' });
  equal(calls, [['K7P2QX', 'guest']]);
});

Deno.test('POST /picks/join: store errors keep their status; 503 if not configured', async () => {
  const withStore = (status: 404 | 409) =>
    createApp({
      store,
      lifecycleStore,
      poolBuilder,
      closingStore,
      joinStore: {
        joinByCode: async () => {
          throw new ApiError(status, 'X', 'x');
        },
      },
      getUser: async () => ({ id: 'guest' }),
    });
  const body = JSON.stringify({ code: 'K7P2QX' });
  equal((await withStore(404).request('/picks/join', { method: 'POST', body })).status, 404);
  equal((await withStore(409).request('/picks/join', { method: 'POST', body })).status, 409);
  const unconfigured = createApp({
    store,
    lifecycleStore,
    poolBuilder,
    closingStore,
    getUser: async () => ({ id: 'guest' }),
  });
  equal((await unconfigured.request('/picks/join', { method: 'POST', body })).status, 503);
});
Deno.test(
  'GET Pick attaches authorized reveal hours without changing candidate snapshots',
  async () => {
    let refreshes = 0;
    const snapshot = { placeId: 'a', name: 'Original', lat: 0, lng: 0 };
    const app = createApp({
      store,
      poolBuilder,
      closingStore,
      getUser: async (req) => ({ id: req.headers.get('x-test-user') ?? 'guest' }),
      lifecycleStore: {
        ...lifecycleStore,
        load: async () => ({
          id: 'pick',
          hostId: 'host',
          state: 'completed',
          category: 'food',
          center: { lat: 0, lng: 0 },
          radiusM: 500,
          poolSize: 20,
          deadlineAt: null,
          closeThreshold: 100,
          participantIds: ['host', 'guest'],
          candidates: [{ placeId: 'a', snapshot }],
          hasAnswers: true,
          myAnswers: {},
          winnerPlaceId: 'a',
          decidedAt: null,
          decidedBy: 'clear_winner',
          version: '1',
        }),
      },
      refreshHours: async () => {
        refreshes++;
        return [
          {
            placeId: 'a',
            openNow: null,
            closesAt: null,
            provider: 'mock',
            fetchedAt: null,
            status: 'unavailable',
          },
        ];
      },
    });
    equal(
      (await app.request('/picks/pick', { headers: { 'x-test-user': 'outsider' } })).status,
      403,
    );
    equal(refreshes, 0);
    const response = await app.request('/picks/pick');
    equal(response.status, 200);
    equal(response.headers.get('cache-control'), 'private, no-store');
    const body = await response.json();
    equal(body.candidates, [snapshot]);
    equal(body.winnerPlaceId, 'a');
    equal(body.candidateHours[0].openNow, null);
    equal(refreshes, 1);
  },
);

const ANN = '71111111-1111-4111-8111-111111111111';
const BO = '72222222-2222-4222-8222-222222222222';

function friendsApp(friendsStore?: FriendsStore) {
  return createApp({
    store,
    lifecycleStore,
    poolBuilder,
    closingStore,
    friendsStore,
    getUser: async (req) => {
      if (!req.headers.get('Authorization')) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in');
      return { id: ANN };
    },
  });
}
const auth = { Authorization: 'Bearer t', 'Content-Type': 'application/json' };
const untouched: FriendsStore = {
  list: async () => {
    throw new Error('Unexpected list');
  },
  request: async () => {
    throw new Error('Unexpected request');
  },
  accept: async () => {
    throw new Error('Unexpected accept');
  },
  remove: async () => {
    throw new Error('Unexpected remove');
  },
  takeFriendRequestLimit: async () => true,
};

Deno.test('friends: 401 without a token, before touching the database', async () => {
  const app = friendsApp(untouched);
  equal((await app.request('/friends')).status, 401);
  const post = { method: 'POST', body: JSON.stringify({ email: 'bo@example.com' }) };
  equal((await app.request('/friends/requests', post)).status, 401);
  equal((await app.request(`/friends/${BO}/accept`, { method: 'POST' })).status, 401);
  equal((await app.request(`/friends/${BO}/remove`, { method: 'POST' })).status, 401);
});

Deno.test('friends: 400 for bad input, before touching the database', async () => {
  const app = friendsApp(untouched);
  for (const body of ['{', '[]', '{}', '{"email":"not-an-email"}', '{"email":42}']) {
    const res = await app.request('/friends/requests', { method: 'POST', headers: auth, body });
    equal(res.status, 400);
  }
  equal(
    (await app.request('/friends/not-a-uuid/accept', { method: 'POST', headers: auth })).status,
    400,
  );
  equal(
    (await app.request('/friends/not-a-uuid/remove', { method: 'POST', headers: auth })).status,
    400,
  );
});

Deno.test('friends: list is grouped and never cached', async () => {
  const app = friendsApp({
    ...untouched,
    list: async (userId) => {
      equal(userId, ANN);
      return [
        {
          userId: BO,
          displayName: 'Bo',
          status: 'accepted',
          direction: 'out',
          createdAt: '2026-10-01T00:00:00Z',
          acceptedAt: '2026-10-02T00:00:00Z',
        },
        {
          userId: 'cy',
          displayName: null,
          status: 'pending',
          direction: 'in',
          createdAt: '2026-10-03T00:00:00Z',
          acceptedAt: null,
        },
      ];
    },
  });
  const res = await app.request('/friends', { headers: auth });
  equal(res.status, 200);
  equal(res.headers.get('cache-control'), 'private, no-store');
  equal(await res.json(), {
    friends: [{ userId: BO, displayName: 'Bo', since: '2026-10-02T00:00:00Z' }],
    incoming: [{ userId: 'cy', displayName: null, since: '2026-10-03T00:00:00Z' }],
  });
});

Deno.test(
  'friends: request, accept and remove pass the caller and a normalized input',
  async () => {
    const calls: string[] = [];
    const app = friendsApp({
      ...untouched,
      request: async (userId, email) => {
        calls.push(`request ${userId} ${email}`);
        return { userId: BO, displayName: 'Bo', status: 'pending' };
      },
      accept: async (userId, friendId) => {
        calls.push(`accept ${userId} ${friendId}`);
      },
      remove: async (userId, friendId) => {
        calls.push(`remove ${userId} ${friendId}`);
      },
    });
    const sent = await app.request('/friends/requests', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ email: '  Bo@Example.com ' }),
    });
    equal(sent.status, 200);
    equal(await sent.json(), { status: 'sent' });
    const accepted = await app.request(`/friends/${BO.toUpperCase()}/accept`, {
      method: 'POST',
      headers: auth,
    });
    equal(await accepted.json(), { status: 'accepted' });
    const removed = await app.request(`/friends/${BO}/remove`, { method: 'POST', headers: auth });
    equal(await removed.json(), { status: 'ok' });
    equal(calls, [`request ${ANN} bo@example.com`, `accept ${ANN} ${BO}`, `remove ${ANN} ${BO}`]);
  },
);

Deno.test('friends: store errors keep their status; 503 if not configured', async () => {
  const app = friendsApp({
    ...untouched,
    request: async () => {
      throw new ApiError(404, 'USER_NOT_FOUND', 'No WTW account uses that email');
    },
    accept: async () => {
      throw new ApiError(404, 'REQUEST_NOT_FOUND', 'That friend request is gone');
    },
  });
  const body = JSON.stringify({ email: 'nobody@example.com' });
  // An unknown email gets the same answer as a real one: no account leak.
  const res = await app.request('/friends/requests', { method: 'POST', headers: auth, body });
  equal(res.status, 200);
  equal(await res.json(), { status: 'sent' });
  equal(
    (await app.request(`/friends/${BO}/accept`, { method: 'POST', headers: auth })).status,
    404,
  );
  equal((await friendsApp().request('/friends', { headers: auth })).status, 503);
});

// The display-name tests below never read the profile or save preferences.
const unusedProfileReads = {
  getProfile: () => Promise.reject(new Error('Unexpected read')),
  setPreferences: () => Promise.reject(new Error('Unexpected write')),
};

Deno.test('POST /me: 401 without a token, before touching the database', async () => {
  const writes: string[] = [];
  const app = createApp({
    store,
    lifecycleStore,
    poolBuilder,
    closingStore,
    profileStore: {
      ...unusedProfileReads,
      setDisplayName: async (_userId, name) => {
        writes.push(name);
      },
    },
    getUser: async () => {
      throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in');
    },
  });
  const result = await app.request('/me', {
    method: 'POST',
    body: JSON.stringify({ displayName: 'Ava' }),
  });
  equal(result.status, 401);
  equal(writes, []);
});

Deno.test('POST /me: 400 for bad names, before touching the database', async () => {
  const app = createApp({
    store,
    lifecycleStore,
    poolBuilder,
    closingStore,
    profileStore: {
      ...unusedProfileReads,
      setDisplayName: async () => {
        throw new Error('Unexpected write');
      },
    },
    getUser: async () => ({ id: 'me' }),
  });
  for (const body of [
    '{',
    '',
    '[]',
    '{}',
    JSON.stringify({ displayName: 42 }),
    JSON.stringify({ displayName: '   ' }),
    JSON.stringify({ displayName: 'a'.repeat(51) }),
    JSON.stringify({ displayName: 'two\nlines' }),
  ]) {
    equal((await app.request('/me', { method: 'POST', body })).status, 400);
  }
});

Deno.test('POST /me: saves the trimmed name for the verified caller only', async () => {
  const calls: [string, string][] = [];
  const app = createApp({
    store,
    lifecycleStore,
    poolBuilder,
    closingStore,
    profileStore: {
      ...unusedProfileReads,
      setDisplayName: async (userId, name) => {
        calls.push([userId, name]);
      },
    },
    getUser: async () => ({ id: 'me' }),
  });
  const result = await app.request('/me', {
    method: 'POST',
    // A userId in the body is ignored: the row is always the token's user.
    body: JSON.stringify({ displayName: '  Ava 🔥  ', userId: 'someone-else' }),
  });
  equal(result.status, 200);
  equal(await result.json(), { displayName: 'Ava 🔥' });
  equal(calls, [['me', 'Ava 🔥']]);
});

Deno.test('POST /me: 503 when profiles are not configured', async () => {
  const app = createApp({
    store,
    lifecycleStore,
    poolBuilder,
    closingStore,
    getUser: async () => ({ id: 'me' }),
  });
  const body = JSON.stringify({ displayName: 'Ava' });
  equal((await app.request('/me', { method: 'POST', body })).status, 503);
});

function notifyApp(user: string | null) {
  const calls: unknown[][] = [];
  const notifyStore: NotifyStore = {
    insert: async () => [],
    tokensFor: async () => [],
    deleteTokens: async () => {},
    list: async (userId) => {
      calls.push(['list', userId]);
      return [];
    },
    markRead: async (id, userId) => {
      calls.push(['markRead', id, userId]);
    },
    registerToken: async (userId, token, platform) => {
      calls.push(['registerToken', userId, token, platform]);
    },
    removeToken: async (userId, token) => {
      calls.push(['removeToken', userId, token]);
    },
  };
  const app = createApp({
    store,
    lifecycleStore,
    poolBuilder,
    closingStore,
    notifyStore,
    getUser: async () => {
      if (!user) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in');
      return { id: user };
    },
  });
  return { app, calls };
}

Deno.test('notifications: 401 without a token, before any query', async () => {
  const { app, calls } = notifyApp(null);
  equal((await app.request('/notifications')).status, 401);
  equal((await app.request('/push-tokens', { method: 'POST', body: '{"token":"x"}' })).status, 401);
  equal(calls, []);
});

Deno.test('notifications: always the verified caller, never a body-supplied user', async () => {
  const { app, calls } = notifyApp('me');
  const inbox = await app.request('/notifications');
  equal(inbox.status, 200);
  equal(inbox.headers.get('cache-control'), 'private, no-store');
  equal(await inbox.json(), { notifications: [], unreadCount: 0 });
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
  equal((await app.request(`/notifications/${id}/read`, { method: 'POST' })).status, 200);
  const token = await app.request('/push-tokens', {
    method: 'POST',
    body: JSON.stringify({ token: 'ExponentPushToken[abc]', platform: 'ios', userId: 'someone' }),
  });
  equal(token.status, 200);
  const removed = await app.request('/push-tokens/remove', {
    method: 'POST',
    body: JSON.stringify({ token: 'ExponentPushToken[abc]' }),
  });
  equal(removed.status, 200);
  equal(calls, [
    ['list', 'me'],
    ['markRead', id, 'me'],
    ['registerToken', 'me', 'ExponentPushToken[abc]', 'ios'],
    ['removeToken', 'me', 'ExponentPushToken[abc]'],
  ]);
});

Deno.test('notifications: bad token 400; not configured 503', async () => {
  const { app } = notifyApp('me');
  const bad = await app.request('/push-tokens', {
    method: 'POST',
    body: JSON.stringify({ token: 'nope', platform: 'ios' }),
  });
  equal(bad.status, 400);
  const bare = createApp({
    store,
    lifecycleStore,
    poolBuilder,
    closingStore,
    getUser: async () => ({ id: 'me' }),
  });
  equal((await bare.request('/notifications')).status, 503);
});

Deno.test(
  'Discover authenticates, validates, uses caller profile and returns a bounded non-paginated feed',
  async () => {
    let profileUser = '';
    const app = createApp({
      store,
      lifecycleStore,
      poolBuilder,
      closingStore,
      getUser: async (req) => {
        if (!req.headers.has('authorization'))
          throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in');
        return { id: 'josh' };
      },
      discoverStore: {
        preferences: async (id) => {
          profileUser = id;
          return { categories: ['activities'] };
        },
        saved: async () => [],
        save: async () => {},
        remove: async () => {},
      },
      discoverPool: {
        buildPool: async (request) =>
          Array.from({ length: 25 }, (_, i) => ({
            placeId: `${request.category}-${i}`,
            name: 'Place',
            category: request.category,
            lat: 40,
            lng: -73,
            provider: 'mock' as const,
          })),
      },
    });
    equal((await app.request('/discover?lat=40&lng=-73')).status, 401);
    const headers = { authorization: 'Bearer test' };
    equal((await app.request('/discover?lat=no&lng=-73', { headers })).status, 400);
    const response = await app.request('/discover?lat=40&lng=-73', { headers });
    equal(response.status, 200);
    equal(response.headers.get('cache-control'), 'private, no-store');
    const body = await response.json();
    equal(profileUser, 'josh');
    equal(body.places.length, 20);
    equal(body.places[0].category, 'activities');
    equal(body.fallback, true);
    equal('nextPage' in body, false);
  },
);

Deno.test(
  'Saved routes derive identity from auth, DELETE works with CORS, and do not persist content',
  async () => {
    const writes: unknown[] = [];
    const app = createApp({
      store,
      lifecycleStore,
      poolBuilder,
      closingStore,
      getUser: async () => ({ id: 'josh' }),
      discoverStore: {
        preferences: async () => ({}),
        saved: async (id) => {
          equal(id, 'josh');
          return [{ placeId: 'a', createdAt: 'today' }];
        },
        save: async (...args) => {
          writes.push(args);
        },
        remove: async (...args) => {
          writes.push(args);
        },
      },
    });
    equal(
      (
        await app.request('/saved/a', {
          method: 'POST',
          body: JSON.stringify({ userId: 'other', snapshot: { name: 'ignored' } }),
        })
      ).status,
      200,
    );
    equal((await app.request('/saved/a', { method: 'DELETE' })).status, 200);
    equal(writes, [
      ['josh', 'a'],
      ['josh', 'a'],
    ]);
    equal((await (await app.request('/saved')).json()).places.length, 1);
    equal((await app.request('/saved/' + 'a'.repeat(257), { method: 'POST' })).status, 400);
    const corsResponse = await app.request('/saved/a', {
      method: 'OPTIONS',
      headers: { Origin: 'https://example.test', 'Access-Control-Request-Method': 'DELETE' },
    });
    equal(corsResponse.headers.get('access-control-allow-methods')?.includes('DELETE'), true);
  },
);

Deno.test('Rate limits return 429 before create/start/refresh writes or pool calls', async () => {
  const pick = {
    id: 'pick',
    hostId: 'josh',
    state: 'draft' as const,
    category: 'food' as const,
    center: { lat: 40, lng: -73 },
    radiusM: 1000,
    poolSize: 20,
    deadlineAt: null,
    closeThreshold: 100,
    participantIds: ['josh', 'friend'],
    candidates: [],
    hasAnswers: false,
    myAnswers: {},
    winnerPlaceId: null,
    decidedAt: null,
    decidedBy: null,
    version: '1',
  };
  const scopes: string[] = [];
  const app = createApp({
    store,
    lifecycleStore: { ...lifecycleStore, load: async () => pick },
    poolBuilder,
    closingStore,
    getUser: async () => ({ id: 'josh' }),
    checkLimit: async (scope, user, id) => {
      equal(user, 'josh');
      if (scope !== 'create') equal(id, 'pick');
      scopes.push(scope);
      throw new ApiError(429, 'RATE_LIMITED', 'Request limit reached');
    },
  });
  equal(
    (
      await app.request('/picks', {
        method: 'POST',
        body: JSON.stringify({ category: 'food', center: pick.center, radiusM: 1000 }),
      })
    ).status,
    429,
  );
  equal((await app.request('/picks/pick/start', { method: 'POST' })).status, 429);
  equal((await app.request('/picks/pick/refresh', { method: 'POST' })).status, 429);
  equal(scopes, ['create', 'start', 'refresh']);
  pick.hostId = 'other';
  equal((await app.request('/picks/pick/start', { method: 'POST' })).status, 403);
  equal(scopes.length, 3);
});

function profileApp(
  rows: Map<
    string,
    { displayName: string | null; preferences: unknown; preferencesUpdatedAt: string | null }
  >,
  userId = 'me',
) {
  return createApp({
    store,
    lifecycleStore,
    poolBuilder,
    closingStore,
    profileStore: {
      setDisplayName: () => Promise.reject(new Error('Unexpected write')),
      getProfile: async (id) => rows.get(id) ?? null,
      setPreferences: async (id, preferences) => {
        const row = rows.get(id) ?? {
          displayName: null,
          preferences: {},
          preferencesUpdatedAt: null,
        };
        rows.set(id, { ...row, preferences, preferencesUpdatedAt: '2026-10-30T00:00:00Z' });
      },
    },
    getUser: async () => ({ id: userId }),
  });
}

Deno.test('GET /me: my name, preferences and onboarding flag, never someone else’s', async () => {
  const rows = new Map([
    [
      'me',
      {
        displayName: 'Ava',
        preferences: { types: ['cafe'], priceMax: 2 },
        preferencesUpdatedAt: null,
      },
    ],
    ['other', { displayName: 'Bo', preferences: { types: ['zoo'] }, preferencesUpdatedAt: 'x' }],
  ]);
  const result = await profileApp(rows).request('/me?userId=other');
  equal(result.status, 200);
  equal(await result.json(), {
    displayName: 'Ava',
    preferences: {
      categories: [],
      types: ['cafe'],
      dislikedTypes: [],
      priceMax: 2,
      maxDistanceM: null,
    },
    onboarded: false,
  });
});

Deno.test('POST /me/preferences: 400 for bad answers, before touching the database', async () => {
  const rows = new Map();
  const app = profileApp(rows);
  for (const body of [
    '{',
    '{}',
    JSON.stringify({ preferences: [] }),
    JSON.stringify({ preferences: { categories: ['nightlife'] } }),
    JSON.stringify({ preferences: { types: ['casino'] } }),
    JSON.stringify({ preferences: { types: ['cafe'], dislikedTypes: ['cafe'] } }),
    JSON.stringify({ preferences: { priceMax: 5 } }),
    JSON.stringify({ preferences: { maxDistanceM: 123 } }),
  ]) {
    equal((await app.request('/me/preferences', { method: 'POST', body })).status, 400);
  }
  equal(rows.size, 0);
});

Deno.test(
  'POST /me/preferences: saves for the verified caller and marks onboarding done',
  async () => {
    const rows = new Map();
    const app = profileApp(rows);
    const preferences = {
      categories: ['food'],
      types: ['pizza_restaurant', 'bowling_alley'],
      dislikedTypes: ['seafood_restaurant'],
      priceMax: 2,
      maxDistanceM: 8045,
    };
    const result = await app.request('/me/preferences', {
      method: 'POST',
      body: JSON.stringify({ preferences, userId: 'someone-else' }),
    });
    equal(result.status, 200);
    equal(await result.json(), { preferences, onboarded: true });
    equal([...rows.keys()], ['me']);
    equal(((await (await app.request('/me')).json()) as { onboarded: boolean }).onboarded, true);
  },
);

Deno.test('GET /me and POST /me/preferences: 401 without a token', async () => {
  const app = createApp({
    store,
    lifecycleStore,
    poolBuilder,
    closingStore,
    profileStore: {
      setDisplayName: () => Promise.reject(new Error('Unexpected write')),
      getProfile: () => Promise.reject(new Error('Unexpected read')),
      setPreferences: () => Promise.reject(new Error('Unexpected write')),
    },
    getUser: async () => {
      throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in');
    },
  });
  equal((await app.request('/me')).status, 401);
  equal((await app.request('/me/preferences', { method: 'POST', body: '{}' })).status, 401);
});

// ---------------------------------------------------------------- groups (0012_groups.sql)
// An in-memory GroupsStore with the RPCs' rules: non-members 404, non-owners/hosts 403,
// only the owner's friends can be added, and a group Pick copies who is in the group now.
const OWNER = '71111111-1111-4111-8111-111111111111';
const AVA = '72222222-2222-4222-8222-222222222222';
const BEN = '73333333-3333-4333-8333-333333333333';
const STRANGER = '75555555-5555-4555-8555-555555555555';
const GROUP = 'a0000000-0000-4000-8000-000000000001';
const PICK = 'b0000000-0000-4000-8000-000000000001';
const DRAFT_BODY = { category: 'food', center: { lat: 1, lng: 2 }, radiusM: 500 };

function groupsWorld() {
  const friends = new Set([AVA, BEN]); // the owner's accepted friends
  const members = new Map<string, Set<string>>([[GROUP, new Set([OWNER])]]);
  const picks = new Map<string, { hostId: string; participants: Set<string>; canceled: boolean }>();
  let nextPick = 0;
  const notFound = () => new ApiError(404, 'GROUP_NOT_FOUND', 'Group not found');
  const asOwner = (userId: string, groupId: string) => {
    const m = members.get(groupId);
    if (!m?.has(userId)) throw notFound();
    if (userId !== OWNER) throw new ApiError(403, 'FORBIDDEN', 'Only the group owner can do this');
    return m;
  };
  const groupsStore: GroupsStore = {
    create: async (userId, name) => ({ id: GROUP, name, ownerId: userId }),
    rename: async (userId, groupId) => void asOwner(userId, groupId),
    delete: async (userId, groupId) => {
      asOwner(userId, groupId);
      members.delete(groupId);
    },
    addMembers: async (userId, groupId, ids) => {
      const m = asOwner(userId, groupId);
      if (ids.some((id) => id !== userId && !friends.has(id))) {
        throw new ApiError(403, 'NOT_FRIENDS', 'You can only add your friends');
      }
      const before = m.size;
      ids.forEach((id) => m.add(id));
      return m.size - before;
    },
    removeMember: async (userId, groupId, memberId) =>
      void asOwner(userId, groupId).delete(memberId),
    leave: async (userId, groupId) => {
      if (!members.get(groupId)?.has(userId)) throw notFound();
      if (userId === OWNER) throw new ApiError(409, 'OWNER_CANNOT_LEAVE', 'Delete it instead');
      members.get(groupId)!.delete(userId);
    },
    isMember: async (groupId, userId) => members.get(groupId)?.has(userId) ?? false,
    addGroupToPick: async (pickId, userId, groupId) => {
      const m = members.get(groupId);
      if (!m?.has(userId)) throw notFound();
      const p = picks.get(pickId)!;
      const before = p.participants.size;
      m.forEach((id) => p.participants.add(id));
      return p.participants.size - before;
    },
    invite: async (pickId, userId, ids) => {
      const p = picks.get(pickId);
      if (!p?.participants.has(userId)) throw new ApiError(404, 'PICK_NOT_FOUND', 'Pick not found');
      if (p.hostId !== userId) throw new ApiError(403, 'FORBIDDEN', 'Only the host can do this');
      if (ids.some((id) => id !== userId && !friends.has(id))) {
        throw new ApiError(403, 'NOT_FRIENDS', 'You can only add your friends');
      }
      const before = p.participants.size;
      ids.forEach((id) => p.participants.add(id));
      return p.participants.size - before;
    },
  };
  const lifecycle: LifecycleStore = {
    ...lifecycleStore,
    createPick: async (hostId) => {
      const id = nextPick++ === 0 ? PICK : `b0000000-0000-4000-8000-00000000000${nextPick}`;
      picks.set(id, { hostId, participants: new Set([hostId]), canceled: false });
      return { id };
    },
    cancel: async (pickId) => {
      picks.get(pickId)!.canceled = true;
    },
  };
  const app = createApp({
    store,
    poolBuilder,
    closingStore,
    getUser: async (req) => {
      const id = req.headers.get('x-test-user');
      if (!id) throw new ApiError(401, 'UNAUTHORIZED', 'Missing bearer token');
      return { id };
    },
    lifecycleStore: lifecycle,
    groupsStore,
  });
  const post = (path: string, user: string | null, body?: unknown) =>
    app.request(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(user ? { 'x-test-user': user } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { post, members, picks, groupsStore };
}

Deno.test('POST /groups: 401 without a token, 400 for a bad name, 201 trimmed', async () => {
  const { post } = groupsWorld();
  equal((await post('/groups', null, { name: 'Roommates' })).status, 401);
  for (const name of ['', '   ', 'x'.repeat(51), 7, 'tab\there']) {
    const res = await post('/groups', OWNER, { name });
    equal(res.status, 400);
    equal((await res.json()).error.code, 'INVALID_INPUT');
  }
  equal((await post('/groups', OWNER, { name: '😀'.repeat(50) })).status, 201);
  const res = await post('/groups', OWNER, { name: '  Roommates ' });
  equal(res.status, 201);
  equal(await res.json(), { id: GROUP, name: 'Roommates', ownerId: OWNER });
});

Deno.test('group routes: 503 when groups are not configured, after authenticating', async () => {
  const app = createApp({
    store,
    lifecycleStore,
    poolBuilder,
    closingStore,
    getUser: async () => ({ id: OWNER }),
  });
  for (const path of ['/groups', `/groups/${GROUP}/leave`, `/picks/${PICK}/invite`]) {
    equal((await app.request(path, { method: 'POST', body: '{}' })).status, 503);
  }
});

Deno.test('only friends can be added to a group, and only by the owner', async () => {
  const { post, members } = groupsWorld();
  const stranger = await post(`/groups/${GROUP}/members`, OWNER, { userIds: [STRANGER] });
  equal(stranger.status, 403);
  equal((await stranger.json()).error.code, 'NOT_FRIENDS');
  const mixed = await post(`/groups/${GROUP}/members`, OWNER, { userIds: [AVA, STRANGER] });
  equal(mixed.status, 403);
  equal([...members.get(GROUP)!], [OWNER]); // all or nothing
  const ok = await post(`/groups/${GROUP}/members`, OWNER, { userIds: [AVA, BEN, AVA] });
  equal(await ok.json(), { added: 2 });
  equal((await post(`/groups/${GROUP}/members`, AVA, { userIds: [BEN] })).status, 403);
  for (const userIds of [[], ['not-a-uuid'], undefined, Array(26).fill(AVA)]) {
    equal((await post(`/groups/${GROUP}/members`, OWNER, { userIds })).status, 400);
  }
  equal((await post('/groups/not-a-uuid/members', OWNER, { userIds: [AVA] })).status, 400);
});

Deno.test('a non-member cannot see or change a group (404, not 403)', async () => {
  const { post } = groupsWorld();
  for (const [path, body] of [
    [`/groups/${GROUP}/rename`, { name: 'Mine' }],
    [`/groups/${GROUP}/delete`, undefined],
    [`/groups/${GROUP}/members`, { userIds: [AVA] }],
    [`/groups/${GROUP}/leave`, undefined],
  ] as const) {
    const res = await post(path, STRANGER, body);
    equal(res.status, 404);
    equal((await res.json()).error.code, 'GROUP_NOT_FOUND');
  }
  const pick = await post('/picks', STRANGER, { ...DRAFT_BODY, groupId: GROUP });
  equal(pick.status, 404);
});

Deno.test('POST /picks with groupId adds every member; without it, nothing changes', async () => {
  const { post, picks } = groupsWorld();
  await post(`/groups/${GROUP}/members`, OWNER, { userIds: [AVA, BEN] });
  const res = await post('/picks', OWNER, { ...DRAFT_BODY, groupId: GROUP.toUpperCase() });
  equal(res.status, 201);
  equal(await res.json(), { pickId: PICK, state: 'draft', groupId: GROUP, added: 2 });
  equal([...picks.get(PICK)!.participants].sort(), [OWNER, AVA, BEN].sort());
  const plain = await post('/picks', OWNER, DRAFT_BODY);
  equal(plain.status, 201);
  equal(Object.keys(await plain.json()), ['pickId', 'state']);
  equal((await post('/picks', OWNER, { ...DRAFT_BODY, groupId: 'nope' })).status, 400);
  // Bad Pick input is a 400 before any group lookup or Pick is created.
  const before = picks.size;
  equal((await post('/picks', OWNER, { groupId: GROUP })).status, 400);
  equal(picks.size, before);
});

Deno.test('a removed member keeps past Picks but is not added to new ones', async () => {
  const { post, picks } = groupsWorld();
  await post(`/groups/${GROUP}/members`, OWNER, { userIds: [AVA, BEN] });
  const first = await (await post('/picks', OWNER, { ...DRAFT_BODY, groupId: GROUP })).json();
  equal((await post(`/groups/${GROUP}/members/${BEN}/remove`, OWNER)).status, 200);
  equal(picks.get(first.pickId)!.participants.has(BEN), true);
  const second = await (await post('/picks', OWNER, { ...DRAFT_BODY, groupId: GROUP })).json();
  equal(second.added, 1);
  equal(picks.get(second.pickId)!.participants.has(BEN), false);
  // And Ben can no longer start one for the group.
  equal((await post('/picks', BEN, { ...DRAFT_BODY, groupId: GROUP })).status, 404);
});

Deno.test(
  'POST /picks with groupId cancels the empty draft if adding the group fails',
  async () => {
    const world = groupsWorld();
    world.groupsStore.addGroupToPick = async () => {
      throw new ApiError(404, 'GROUP_NOT_FOUND', 'Group not found');
    };
    const res = await world.post('/picks', OWNER, { ...DRAFT_BODY, groupId: GROUP });
    equal(res.status, 404);
    equal(world.picks.get(PICK)!.canceled, true);
  },
);

Deno.test('leave: members can, the owner cannot', async () => {
  const { post, members } = groupsWorld();
  await post(`/groups/${GROUP}/members`, OWNER, { userIds: [AVA] });
  equal(await (await post(`/groups/${GROUP}/leave`, AVA)).json(), { status: 'ok' });
  equal(members.get(GROUP)!.has(AVA), false);
  const owner = await post(`/groups/${GROUP}/leave`, OWNER);
  equal(owner.status, 409);
  equal((await owner.json()).error.code, 'OWNER_CANNOT_LEAVE');
});

Deno.test('POST /picks/:id/invite: host only, friends only', async () => {
  const { post, picks } = groupsWorld();
  await post('/picks', OWNER, DRAFT_BODY);
  equal((await post(`/picks/${PICK}/invite`, OWNER, { userIds: [STRANGER] })).status, 403);
  equal(await (await post(`/picks/${PICK}/invite`, OWNER, { userIds: [AVA] })).json(), {
    added: 1,
  });
  equal(picks.get(PICK)!.participants.has(AVA), true);
  equal((await post(`/picks/${PICK}/invite`, AVA, { userIds: [BEN] })).status, 403);
  equal((await post(`/picks/${PICK}/invite`, OWNER, {})).status, 400);
  equal((await post(`/picks/${PICK}/invite`, null, { userIds: [AVA] })).status, 401);
});

function plansApp(user: string | null) {
  const calls: unknown[][] = [];
  const plansStore: PlansStore = {
    setPlanTime: async (...args) => {
      calls.push(['setPlanTime', ...args]);
      return [];
    },
    rsvp: async (...args) => {
      calls.push(['rsvp', ...args]);
    },
    outcome: async (...args) => {
      calls.push(['outcome', ...args]);
    },
    loadPlan: async () => {
      throw new ApiError(404, 'PICK_NOT_FOUND', 'Pick not found');
    },
    history: async (...args) => {
      calls.push(['history', ...args]);
      return [];
    },
    again: async (...args) => {
      calls.push(['again', ...args]);
      return { id: 'new', addedUserIds: [] };
    },
    finalistCounts: async () => [{ placeId: 'a', rank: 1, yes: 0, maybe: 0, no: 2, n: 2 }],
  };
  const app = createApp({
    store,
    lifecycleStore,
    poolBuilder,
    closingStore,
    plansStore,
    getUser: async () => {
      if (!user) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in');
      return { id: user };
    },
  });
  return { app, calls };
}

Deno.test('plans: 401 without a token on every route, before any query', async () => {
  const { app, calls } = plansApp(null);
  for (const [method, path] of [
    ['GET', '/picks/p/plan'],
    ['GET', '/picks/p/reasons'],
    ['POST', '/picks/p/plan-time'],
    ['POST', '/picks/p/rsvp'],
    ['POST', '/picks/p/outcome'],
    ['POST', '/picks/p/again'],
    ['GET', '/history'],
    ['GET', '/groups/g/history'],
  ]) {
    equal((await app.request(path, { method })).status, 401);
  }
  equal(calls, []);
});

Deno.test('plans: caller id from the token; bad input 400; store errors keep status', async () => {
  const { app, calls } = plansApp('me');
  const post = (path: string, body: unknown) =>
    app.request(path, { method: 'POST', body: JSON.stringify(body) });
  equal((await post('/picks/p/rsvp', { status: 'going', userId: 'other' })).status, 200);
  equal((await post('/picks/p/rsvp', { status: 'nah' })).status, 400);
  equal((await post('/picks/p/outcome', { went: 'yes' })).status, 400);
  equal((await post('/picks/p/plan-time', { planAt: '2001-01-01T00:00:00Z' })).status, 400);
  const again = await post('/picks/p/again', {});
  equal(again.status, 201);
  equal(await again.json(), { pickId: 'new', state: 'draft' });
  equal((await app.request('/picks/p/plan')).status, 404);
  const history = await app.request('/history');
  equal(history.headers.get('cache-control'), 'private, no-store');
  equal((await app.request('/groups/not-a-uuid/history')).status, 404);
  const reasons = await app.request('/picks/p/reasons');
  equal(await reasons.json(), {
    reasons: [{ placeId: 'a', rank: 1, reason: 'The group’s top match' }],
  });
  equal(calls, [
    ['rsvp', 'p', 'me', 'going'],
    ['again', 'p', 'me'],
    ['history', 'me', null],
  ]);
});

// ---------------------------------------------------------------- 0014: safety and invites
const ME = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const TOKEN = 'AbCdEfGhIjKlMnOpQrStU_';

function safetyApp(calls: string[], overrides: Partial<SafetyStore & InviteStore> = {}) {
  return createApp({
    store,
    lifecycleStore,
    poolBuilder,
    closingStore,
    getUser: async (req) => {
      if (!req.headers.get('Authorization')) throw new ApiError(401, 'UNAUTHENTICATED', 'No token');
      return { id: ME };
    },
    safetyStore: {
      block: async (u, t) => void calls.push(`block ${u} ${t}`),
      unblock: async (u, t) => void calls.push(`unblock ${u} ${t}`),
      report: async (u, r) => void calls.push(`report ${u} ${r.kind} ${r.targetId} ${r.reason}`),
      setLobbyLocked: async (p, u, l) => {
        calls.push(`lock ${p} ${u} ${l}`);
        return l;
      },
      ...overrides,
    },
    inviteStore: {
      create: async (u, input) => {
        calls.push(`create ${u} ${input.kind} ${input.targetId} ${input.maxUses}`);
        return {
          token: TOKEN,
          kind: input.kind,
          targetId: input.targetId,
          expiresAt: 'later',
          maxUses: input.maxUses,
        };
      },
      accept: async (t, u) => {
        calls.push(`accept ${t} ${u}`);
        return { kind: 'pick', targetId: OTHER };
      },
      revoke: async (t, u) => void calls.push(`revoke ${t} ${u}`),
      ...overrides,
    },
  });
}
const authed = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

Deno.test('safety and invite routes: 401 without a token, before any store call', async () => {
  const calls: string[] = [];
  const app = safetyApp(calls);
  const routes: [string, string][] = [
    ['POST', `/blocks/${OTHER}`],
    ['POST', `/blocks/${OTHER}/remove`],
    ['POST', '/reports'],
    ['POST', '/picks/p/lock'],
    ['POST', '/invites'],
    ['POST', `/invites/${TOKEN}/accept`],
    ['DELETE', `/invites/${TOKEN}`],
  ];
  for (const [method, path] of routes) {
    equal((await app.request(path, { method })).status, 401);
  }
  equal(calls, []);
});

Deno.test('safety and invite routes: 503 when not configured', async () => {
  const app = createApp({
    store,
    lifecycleStore,
    poolBuilder,
    closingStore,
    getUser: async () => ({ id: ME }),
  });
  equal((await app.request(`/blocks/${OTHER}`, { method: 'POST' })).status, 503);
  equal((await app.request('/invites', { method: 'POST' })).status, 503);
});

Deno.test(
  'POST /blocks/:userId: blocks for the verified caller; bad ids and self are 400',
  async () => {
    const calls: string[] = [];
    const app = safetyApp(calls);
    equal(await (await app.request(`/blocks/${OTHER}`, authed('POST'))).json(), { status: 'ok' });
    equal(await (await app.request(`/blocks/${OTHER}/remove`, authed('POST'))).json(), {
      status: 'ok',
    });
    equal((await app.request('/blocks/not-a-uuid', authed('POST'))).status, 400);
    equal((await app.request(`/blocks/${ME}`, authed('POST'))).status, 400);
    equal(calls, [`block ${ME} ${OTHER}`, `unblock ${ME} ${OTHER}`]);
  },
);

Deno.test('POST /reports: validates, trims, 201; the store’s 429 passes through', async () => {
  const calls: string[] = [];
  const app = safetyApp(calls);
  const ok = await app.request(
    '/reports',
    authed('POST', { kind: 'user', targetId: OTHER, reason: '  rude  ' }),
  );
  equal(ok.status, 201);
  equal(calls, [`report ${ME} user ${OTHER} rude`]);
  for (const bad of [
    { kind: 'place', targetId: OTHER, reason: 'x' },
    { kind: 'user', targetId: 'x', reason: 'x' },
    { kind: 'user', targetId: OTHER, reason: '   ' },
    { kind: 'user', targetId: OTHER, reason: 'x'.repeat(501) },
  ]) {
    equal((await app.request('/reports', authed('POST', bad))).status, 400);
  }
  const limited = safetyApp([], {
    report: async () => {
      throw new ApiError(429, 'RATE_LIMITED', 'Too many');
    },
  });
  const response = await limited.request(
    '/reports',
    authed('POST', { kind: 'user', targetId: OTHER, reason: 'x' }),
  );
  equal(response.status, 429);
});

Deno.test('POST /picks/:id/lock: needs a boolean', async () => {
  const calls: string[] = [];
  const app = safetyApp(calls);
  equal(await (await app.request('/picks/p1/lock', authed('POST', { locked: true }))).json(), {
    locked: true,
  });
  equal((await app.request('/picks/p1/lock', authed('POST', { locked: 'yes' }))).status, 400);
  equal(calls, [`lock p1 ${ME} true`]);
});

Deno.test('POST /invites: 201 with a wtw://i/ url; bad input is 400', async () => {
  const calls: string[] = [];
  const app = safetyApp(calls);
  const response = await app.request('/invites', authed('POST', { kind: 'pick', targetId: OTHER }));
  equal(response.status, 201);
  const body = await response.json();
  equal(body.url, `wtw://i/${TOKEN}`);
  equal(calls, [`create ${ME} pick ${OTHER} null`]);
  for (const bad of [
    { kind: 'party', targetId: OTHER },
    { kind: 'pick', targetId: 'x' },
    { kind: 'pick', targetId: OTHER, maxUses: 0 },
    { kind: 'pick', targetId: OTHER, maxUses: 1.5 },
  ]) {
    equal((await app.request('/invites', authed('POST', bad))).status, 400);
  }
});

Deno.test(
  'POST /invites/:token/accept: a malformed token looks like any unusable one',
  async () => {
    const calls: string[] = [];
    const unusable = safetyApp([], {
      accept: async () => {
        throw INVITE_NOT_FOUND;
      },
    });
    const malformed = await safetyApp(calls).request('/invites/short/accept', authed('POST'));
    const rejected = await unusable.request(`/invites/${TOKEN}/accept`, authed('POST'));
    equal(malformed.status, 404);
    equal(rejected.status, 404);
    equal(await malformed.json(), await rejected.json());
    equal(calls, []);
    const ok = await safetyApp(calls).request(`/invites/${TOKEN}/accept`, authed('POST'));
    equal(await ok.json(), { kind: 'pick', targetId: OTHER });
    equal(calls, [`accept ${TOKEN} ${ME}`]);
  },
);

Deno.test('DELETE /invites/:token revokes for the caller; CORS allows DELETE', async () => {
  const calls: string[] = [];
  const app = safetyApp(calls);
  equal(await (await app.request(`/invites/${TOKEN}`, authed('DELETE'))).json(), { status: 'ok' });
  equal(calls, [`revoke ${TOKEN} ${ME}`]);
  const preflight = await app.request(`/invites/${TOKEN}`, {
    method: 'OPTIONS',
    headers: { Origin: 'http://localhost:8081', 'Access-Control-Request-Method': 'DELETE' },
  });
  equal(preflight.headers.get('access-control-allow-methods')?.includes('DELETE'), true);
});

Deno.test(
  'POST /picks/join: every failed code gets the same body; rate limiting is 429',
  async () => {
    const withError = (error: ApiError) =>
      createApp({
        store,
        lifecycleStore,
        poolBuilder,
        closingStore,
        joinStore: {
          joinByCode: async () => {
            throw error;
          },
        },
        getUser: async () => ({ id: ME }),
      });
    const body = JSON.stringify({ code: 'K7P2QX' });
    const failed = await withError(JOIN_CODE_NOT_FOUND).request('/picks/join', {
      method: 'POST',
      body,
    });
    equal(failed.status, 404);
    equal((await failed.json()).error.code, 'JOIN_CODE_NOT_FOUND');
    const limited = await withError(JOIN_RATE_LIMITED).request('/picks/join', {
      method: 'POST',
      body,
    });
    equal(limited.status, 429);
    equal((await limited.json()).error.code, 'RATE_LIMITED');
  },
);

Deno.test(
  'Phase 2 create validates custom options and forwards includeSaved to existing lifecycle',
  async () => {
    let input: unknown;
    const app = createApp({
      store,
      lifecycleStore: {
        ...lifecycleStore,
        createPick: async (host, body) => {
          equal(host, 'josh');
          input = body;
          return { id: 'custom-pick' };
        },
      },
      poolBuilder,
      closingStore,
      getUser: async () => ({ id: 'josh' }),
    });
    const body = {
      category: 'custom',
      center: { lat: 40, lng: -73 },
      radiusM: 1000,
      includeSaved: true,
      customOptions: [
        { name: 'Game night' },
        { name: 'Basketball' },
        { name: 'Cookout' },
        { name: 'Study session' },
      ],
    };
    const response = await app.request('/picks', { method: 'POST', body: JSON.stringify(body) });
    equal(response.status, 201);
    equal((input as { poolSize: number }).poolSize, 20);
    equal((input as { includeSaved: boolean }).includeSaved, true);
    equal(
      (
        await app.request('/picks', {
          method: 'POST',
          body: JSON.stringify({ ...body, customOptions: [{ name: 'one' }] }),
        })
      ).status,
      400,
    );
  },
);
Deno.test(
  'Sweep cleanup is secret-protected, uses TTL cutoff, logs count and preserves deadline work',
  async () => {
    let count = 0;
    const app = createApp({
      store,
      lifecycleStore,
      poolBuilder,
      closingStore,
      getUser: async () => ({ id: 'josh' }),
      cronSecret: 'test',
      sweepStore: { expiredPage: async () => [] },
      cacheCleanupStore: {
        deleteExpiredOnce: async (day, cutoff) => {
          count++;
          equal(day.length, 10);
          const age = Date.now() - Date.parse(cutoff);
          if (age < 300000 || age > 301000) throw new Error('wrong TTL');
          return { removed: 7, ran: true };
        },
      },
    });
    equal((await app.request('/internal/sweep', { method: 'POST' })).status, 401);
    equal(count, 0);
    const response = await app.request('/internal/sweep', {
      method: 'POST',
      headers: { 'x-cron-secret': 'test' },
    });
    equal(response.status, 200);
    equal((await response.json()).cacheCleanup.removed, 7);
    equal(count, 1);
  },
);
Deno.test(
  'Hang routes authenticate, derive author and report missing teammate capabilities',
  async () => {
    const post = {
      id: 'post',
      authorId: 'josh',
      activity: 'Game night',
      startsAt: new Date(Date.now() + 3600000).toISOString(),
      expiresAt: new Date(Date.now() + 7200000).toISOString(),
      audience: 'all_friends' as const,
      groupId: null,
    };
    const app = createApp({
      store,
      lifecycleStore,
      poolBuilder,
      closingStore,
      getUser: async (req) => {
        if (!req.headers.has('Authorization'))
          throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in');
        return { id: 'josh' };
      },
      hangStore: {
        create: async (authorId, input) => ({ ...input, id: 'post', authorId }),
        listOwn: async () => [post],
        load: async () => post,
      },
    });
    equal((await app.request('/hang')).status, 401);
    const headers = { Authorization: 'Bearer test' };
    const created = await app.request('/hang', {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...post, authorId: 'other' }),
    });
    equal(created.status, 201);
    equal((await created.json()).authorId, 'josh');
    equal((await app.request('/hang', { headers })).status, 200);
    equal(
      (
        await app.request('/hang/post/respond', {
          method: 'POST',
          headers,
          body: '{"status":"down"}',
        })
      ).status,
      503,
    );
    const response = await app.request('/hang/post/pick', { method: 'POST', headers });
    equal(response.status, 503);
    equal((await response.json()).error.code, 'HANG_PICK_HELPER_UNAVAILABLE');
  },
);

function accountApp(deleted: string[], deleteUser?: () => Promise<void>) {
  return createApp({
    store,
    lifecycleStore,
    poolBuilder,
    closingStore,
    getUser: async (req) => {
      if (!req.headers.get('Authorization')) throw new ApiError(401, 'UNAUTHENTICATED', 'No token');
      return { id: 'me' };
    },
    accountStore: {
      deleteUser:
        deleteUser ??
        (async (userId) => {
          deleted.push(userId);
        }),
    },
  });
}

Deno.test('DELETE /me: 401 without a token, before deleting anything', async () => {
  const deleted: string[] = [];
  const response = await accountApp(deleted).request('/me', { method: 'DELETE' });
  equal(response.status, 401);
  equal(deleted, []);
});

Deno.test('DELETE /me: deletes the verified caller only, whatever the request names', async () => {
  const deleted: string[] = [];
  const response = await accountApp(deleted).request('/me?userId=someone-else', {
    method: 'DELETE',
    headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'someone-else' }),
  });
  equal(response.status, 200);
  equal(await response.json(), { status: 'ok' });
  equal(deleted, ['me']);
});

Deno.test('DELETE /me: a failed deletion is a generic 500, unconfigured is 503', async () => {
  const failing = accountApp([], async () => {
    throw new Error('secret Auth details');
  });
  const response = await failing.request('/me', {
    method: 'DELETE',
    headers: { Authorization: 'Bearer token' },
  });
  equal(response.status, 500);
  equal((await response.text()).includes('secret'), false);
  const unconfigured = createApp({
    store,
    lifecycleStore,
    poolBuilder,
    closingStore,
    getUser: async () => ({ id: 'me' }),
  });
  equal((await unconfigured.request('/me', { method: 'DELETE' })).status, 503);
});

Deno.test('DELETE /me: CORS preflight allows DELETE from the web app', async () => {
  const response = await accountApp([]).request('/me', {
    method: 'OPTIONS',
    headers: { Origin: 'http://localhost:8081', 'Access-Control-Request-Method': 'DELETE' },
  });
  equal(response.headers.get('access-control-allow-methods')?.includes('DELETE'), true);
});

Deno.test('friends: requests stop at the daily limit, before touching the database', async () => {
  const app = friendsApp({ ...untouched, takeFriendRequestLimit: async () => false });
  const body = JSON.stringify({ email: 'bo@example.com' });
  const res = await app.request('/friends/requests', { method: 'POST', headers: auth, body });
  equal(res.status, 429);
});

Deno.test('text other people see is filtered: POST /me', async () => {
  const app = createApp({
    store,
    lifecycleStore,
    poolBuilder,
    closingStore,
    profileStore: {
      ...unusedProfileReads,
      setDisplayName: () => Promise.reject(new Error('Unexpected write')),
    },
    getUser: async () => ({ id: 'me' }),
  });
  const body = JSON.stringify({ displayName: 'fuck' });
  const res = await app.request('/me', { method: 'POST', body });
  equal(res.status, 400);
  equal((await res.json()).error.code, 'TEXT_NOT_ALLOWED');
});

Deno.test('Discover rate limit is checked before profile or provider access', async () => {
  const app = createApp({
    store,
    lifecycleStore,
    poolBuilder,
    closingStore,
    getUser: async () => ({ id: ANN }),
    checkLimit: async (scope, userId) => {
      equal(scope, 'discover');
      equal(userId, ANN);
      throw new ApiError(429, 'RATE_LIMITED', 'Request limit reached');
    },
    discoverPool: poolBuilder,
    discoverStore: {
      preferences: async () => {
        throw new Error('Must not read preferences');
      },
      saved: async () => [],
      save: async () => {},
      remove: async () => {},
    },
  });
  equal((await app.request('/discover?lat=40&lng=-73')).status, 429);
});
