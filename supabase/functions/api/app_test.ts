import { createApp } from './app.ts';
import { ApiError } from '../_shared/api/errors.ts';
import type { HeartbeatStore } from '../_shared/api/heartbeat.ts';
import type { LifecycleStore } from '../_shared/api/lifecycle.ts';
import type { ClosingStore } from '../_shared/api/closing.ts';
import type { VotingStore } from '../_shared/api/voting.ts';
import type { PoolBuilder } from '../_shared/places/pool.ts';

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
