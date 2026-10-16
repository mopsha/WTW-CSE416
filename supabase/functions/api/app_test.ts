import { createApp } from './app.ts';
import { ApiError } from '../_shared/api/errors.ts';
import type { HeartbeatStore } from '../_shared/api/heartbeat.ts';
import type { LifecycleStore } from '../_shared/api/lifecycle.ts';
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
function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
Deno.test('public health and uniform 404', async () => {
  const app = createApp({
    store,
    lifecycleStore,
    poolBuilder,
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
    getUser: async () => {
      throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in');
    },
  });
  const result = await app.request('/picks/p/rank', { method: 'POST' });
  equal(result.status, 401);
  equal(await result.json(), { error: { code: 'UNAUTHENTICATED', message: 'Sign in' } });
});
Deno.test('invalid JSON and missing Pick', async () => {
  const app = createApp({ store, lifecycleStore, poolBuilder, getUser: async () => ({ id: 'host' }) });
  equal((await app.request('/picks/p/swipes', { method: 'POST', body: '{' })).status, 400);
  equal((await app.request('/picks/p/rank', { method: 'POST' })).status, 404);
  equal((await app.request('/picks/p/refresh', { method: 'POST', body: '{' })).status, 400);
  equal((await app.request('/picks/p', { method: 'GET' })).status, 404);
});
Deno.test('preflight does not require authentication', async () => {
  const app = createApp({
    store,
    lifecycleStore,
    poolBuilder,
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
    { store, lifecycleStore, poolBuilder, getUser: async () => ({ id: 'host' }) },
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
