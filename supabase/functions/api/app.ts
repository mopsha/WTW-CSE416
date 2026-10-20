import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { ApiError, errorResponse } from '../_shared/api/errors.ts';
import { rank, swipe, type HeartbeatStore } from '../_shared/api/heartbeat.ts';
import {
  cancelPick,
  createPick,
  getPick,
  refreshPick,
  startPick,
  type LifecycleStore,
} from '../_shared/api/lifecycle.ts';
import { closePick, type ClosingStore } from '../_shared/api/closing.ts';
import { castVote, closeVote, type VotingStore } from '../_shared/api/voting.ts';
import type { PoolBuilder } from '../_shared/places/pool.ts';
import { authorizeSweep, sweepDeadlines, type SweepStore } from '../_shared/api/sweep.ts';

async function readJsonBody(c: { req: { text(): Promise<string> } }): Promise<unknown> {
  const raw = await c.req.text();
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Request body must be valid JSON');
  }
}

export function createApp(
  deps: {
    getUser(req: Request): Promise<{ id: string }>;
    store: HeartbeatStore;
    lifecycleStore: LifecycleStore;
    poolBuilder: PoolBuilder;
    closingStore: ClosingStore & VotingStore;
    sweepStore?: SweepStore;
    cronSecret?: string;
  },
  basePath = '',
) {
  const app = new Hono().basePath(basePath);
  app.use(
    '*',
    cors({
      origin: '*',
      allowHeaders: ['Authorization', 'Content-Type', 'apikey', 'x-client-info'],
      allowMethods: ['GET', 'POST', 'OPTIONS'],
    }),
  );
  app.onError((error, c) => {
    const response = errorResponse(error);
    return c.json(response.body, response.status);
  });
  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404));
  app.get('/health', (c) => c.json({ status: 'ok' }));
  app.post('/internal/sweep', async (c) => {
    authorizeSweep(c.req.header('x-cron-secret'), deps.cronSecret);
    if (!deps.sweepStore) {
      throw new ApiError(503, 'SERVER_NOT_CONFIGURED', 'Deadline automation is not configured');
    }
    const result = await sweepDeadlines(deps.sweepStore, deps.closingStore);
    return c.json(result, result.status === 'ok' ? 200 : 503);
  });
  app.post('/picks/:id/swipes', async (c) => {
    const user = await deps.getUser(c.req.raw);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw new ApiError(400, 'INVALID_JSON', 'Request body must be valid JSON');
    }
    const pickId = c.req.param('id');
    const result = await swipe(deps.store, pickId, user.id, body);
    // The swipe is already saved, so a failed auto-close must not turn it into
    // an error; the next swipe, the host, or the deadline sweep closes it instead.
    try {
      await closePick(deps.closingStore, pickId, 'system', null);
    } catch (error) {
      console.error('auto-close after swipe failed', error instanceof Error ? error.name : 'unknown');
    }
    return c.json(result);
  });
  app.post('/picks/:id/rank', async (c) => {
    const user = await deps.getUser(c.req.raw);
    return c.json(await rank(deps.store, c.req.param('id'), user.id));
  });
  app.post('/picks', async (c) => {
    const user = await deps.getUser(c.req.raw);
    const body = await readJsonBody(c);
    return c.json(await createPick(deps.lifecycleStore, user.id, body), 201);
  });
  app.get('/picks/:id', async (c) => {
    const user = await deps.getUser(c.req.raw);
    return c.json(await getPick(deps.lifecycleStore, c.req.param('id'), user.id));
  });
  app.post('/picks/:id/start', async (c) => {
    const user = await deps.getUser(c.req.raw);
    return c.json(
      await startPick(deps.lifecycleStore, deps.poolBuilder, c.req.param('id'), user.id),
    );
  });
  app.post('/picks/:id/refresh', async (c) => {
    const user = await deps.getUser(c.req.raw);
    const body = await readJsonBody(c);
    return c.json(
      await refreshPick(deps.lifecycleStore, deps.poolBuilder, c.req.param('id'), user.id, body),
    );
  });
  app.post('/picks/:id/cancel', async (c) => {
    const user = await deps.getUser(c.req.raw);
    return c.json(await cancelPick(deps.lifecycleStore, c.req.param('id'), user.id));
  });
  app.post('/picks/:id/close', async (c) => {
    const user = await deps.getUser(c.req.raw);
    return c.json(await closePick(deps.closingStore, c.req.param('id'), 'host', user.id));
  });
  app.post('/picks/:id/vote', async (c) => {
    const user = await deps.getUser(c.req.raw);
    const body = await readJsonBody(c);
    return c.json(await castVote(deps.closingStore, c.req.param('id'), user.id, body));
  });
  app.post('/picks/:id/close-vote', async (c) => {
    const user = await deps.getUser(c.req.raw);
    return c.json(await closeVote(deps.closingStore, c.req.param('id'), user.id));
  });
  return app;
}
