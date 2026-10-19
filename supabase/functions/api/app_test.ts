import { createApp } from './app.ts';
import { ApiError } from '../_shared/api/errors.ts';
import type { HeartbeatStore } from '../_shared/api/heartbeat.ts';

const store: HeartbeatStore = {
  loadPick: async () => null,
  upsertSwipe: async () => {
    throw new Error('Unexpected write');
  },
  saveRanking: async () => {
    throw new Error('Unexpected write');
  },
};
function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
Deno.test('public health and uniform 404', async () => {
  const app = createApp({
    store,
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
    getUser: async () => {
      throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in');
    },
  });
  const result = await app.request('/picks/p/rank', { method: 'POST' });
  equal(result.status, 401);
  equal(await result.json(), { error: { code: 'UNAUTHENTICATED', message: 'Sign in' } });
});
Deno.test('invalid JSON and missing Pick', async () => {
  const app = createApp({ store, getUser: async () => ({ id: 'host' }) });
  equal((await app.request('/picks/p/swipes', { method: 'POST', body: '{' })).status, 400);
  equal((await app.request('/picks/p/rank', { method: 'POST' })).status, 404);
});
Deno.test('preflight does not require authentication', async () => {
  const app = createApp({
    store,
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
  const app = createApp({ store, getUser: async () => ({ id: 'host' }) }, '/api');
  equal(await (await app.request('/api/health')).json(), { status: 'ok' });
  const missing = await app.request('/api/unknown');
  equal(missing.status, 404);
  equal(await missing.json(), { error: { code: 'NOT_FOUND', message: 'Route not found' } });
});

Deno.test('GET /picks/:id/progress: counts only, participants only', async () => {
  const progressStore = {
    loadProgress: async () => ({
      state: 'swiping' as const,
      hostId: 'host',
      deadlineAt: null,
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
  const as = (id: string) => createApp({ store, progressStore, getUser: async () => ({ id }) });
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
