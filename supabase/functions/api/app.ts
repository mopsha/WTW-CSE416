import { discover, parseDiscover } from '../_shared/api/discover.ts';
import type { DiscoverPreferences } from '../_shared/domain/discoverScore.ts';
import { parseCreatePick } from '../_shared/api/lifecycle.ts';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { ApiError, errorResponse } from '../_shared/api/errors.ts';
import { swipe, type HeartbeatStore } from '../_shared/api/heartbeat.ts';
import { getProgress, type ProgressStore } from '../_shared/api/progress.ts';
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
import { joinPick, type JoinStore } from '../_shared/api/join.ts';
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
    progressStore?: ProgressStore;
    lifecycleStore: LifecycleStore;
    poolBuilder: PoolBuilder;
    closingStore: ClosingStore & VotingStore;
    joinStore?: JoinStore;
    sweepStore?: SweepStore;
    cronSecret?: string;
    discoverPool?: PoolBuilder;
    discoverStore?: {
      preferences(userId: string): Promise<DiscoverPreferences>;
      saved(userId: string): Promise<{ placeId: string; createdAt: string }[]>;
      save(userId: string, placeId: string): Promise<void>;
      remove(userId: string, placeId: string): Promise<void>;
    };
    checkLimit?: (
      scope: 'create' | 'start' | 'refresh',
      userId: string,
      pickId?: string,
    ) => Promise<void>;
    refreshHours?: Parameters<typeof getPick>[3];
  },
  basePath = '',
) {
  const app = new Hono().basePath(basePath);
  app.use(
    '*',
    cors({
      origin: '*',
      allowHeaders: ['Authorization', 'Content-Type', 'apikey', 'x-client-info'],
      allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
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
      console.error(
        'auto-close after swipe failed',
        error instanceof Error ? error.name : 'unknown',
      );
    }
    return c.json(result);
  });
  // Legacy alias of /close: routes through the canonical closer so the final vote
  // always gets vote_deadline_at and the deadline sweep can finish it.
  app.post('/picks/:id/rank', async (c) => {
    const user = await deps.getUser(c.req.raw);
    return c.json(await closePick(deps.closingStore, c.req.param('id'), 'host', user.id));
  });
  // Live progress (counts only). The app polls this when Realtime is unavailable.
  app.get('/picks/:id/progress', async (c) => {
    const user = await deps.getUser(c.req.raw);
    if (!deps.progressStore) throw new ApiError(503, 'NOT_CONFIGURED', 'Progress is not available');
    return c.json(await getProgress(deps.progressStore, c.req.param('id'), user.id));
  });
  app.get('/discover', async (c) => {
    const user = await deps.getUser(c.req.raw);
    c.header('Cache-Control', 'private, no-store');
    const requests = parseDiscover(new URL(c.req.url).searchParams);
    if (!deps.discoverStore || !deps.discoverPool)
      throw new ApiError(503, 'NOT_CONFIGURED', 'Discover is unavailable');
    const result = await discover(
      deps.discoverPool,
      requests,
      await deps.discoverStore.preferences(user.id),
    );
    return c.json({
      ...result,
      notice: result.fallback
        ? 'Showing fixture places. Live places may be unavailable or the daily provider limit reached.'
        : null,
    });
  });
  app.get('/saved', async (c) => {
    const user = await deps.getUser(c.req.raw);
    c.header('Cache-Control', 'private, no-store');
    if (!deps.discoverStore) throw new ApiError(503, 'NOT_CONFIGURED', 'Saved places unavailable');
    return c.json({ places: await deps.discoverStore.saved(user.id) });
  });
  for (const method of ['post', 'delete'] as const) {
    app[method]('/saved/:placeId', async (c) => {
      const user = await deps.getUser(c.req.raw);
      const placeId = c.req.param('placeId');
      if (!placeId.trim() || placeId.length > 256 || /[\u0000-\u001f]/.test(placeId))
        throw new ApiError(400, 'INVALID_INPUT', 'Invalid place ID');
      if (!deps.discoverStore)
        throw new ApiError(503, 'NOT_CONFIGURED', 'Saved places unavailable');
      if (method === 'post') await deps.discoverStore.save(user.id, placeId);
      else await deps.discoverStore.remove(user.id, placeId);
      return c.json({ status: 'ok' });
    });
  }
  app.post('/picks', async (c) => {
    const user = await deps.getUser(c.req.raw);
    const body = await readJsonBody(c);
    parseCreatePick(body);
    await deps.checkLimit?.('create', user.id);
    return c.json(await createPick(deps.lifecycleStore, user.id, body), 201);
  });
  app.get('/picks/:id', async (c) => {
    c.header('Cache-Control', 'private, no-store');
    const user = await deps.getUser(c.req.raw);
    return c.json(
      await getPick(deps.lifecycleStore, c.req.param('id'), user.id, deps.refreshHours),
    );
  });
  app.post('/picks/:id/start', async (c) => {
    const user = await deps.getUser(c.req.raw);
    return c.json(
      await startPick(
        deps.lifecycleStore,
        deps.poolBuilder,
        c.req.param('id'),
        user.id,
        () => deps.checkLimit?.('start', user.id, c.req.param('id')) ?? Promise.resolve(),
      ),
    );
  });
  app.post('/picks/:id/refresh', async (c) => {
    const user = await deps.getUser(c.req.raw);
    const body = await readJsonBody(c);
    return c.json(
      await refreshPick(
        deps.lifecycleStore,
        deps.poolBuilder,
        c.req.param('id'),
        user.id,
        body,
        () => deps.checkLimit?.('refresh', user.id, c.req.param('id')) ?? Promise.resolve(),
      ),
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
  // Join by code (Lobby code / QR / wtw://join/CODE). Static path, so it never
  // matches /picks/:id routes.
  app.post('/picks/join', async (c) => {
    const user = await deps.getUser(c.req.raw);
    const body = await readJsonBody(c);
    if (!deps.joinStore) throw new ApiError(503, 'NOT_CONFIGURED', 'Joining is not available');
    return c.json(await joinPick(deps.joinStore, user.id, body));
  });
  return app;
}
