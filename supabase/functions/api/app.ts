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
import {
  listNotifications,
  markNotificationRead,
  registerPushToken,
  unregisterPushToken,
  type NotifyStore,
} from '../_shared/api/notify.ts';
import {
  getHistory,
  getPlan,
  getReasons,
  pickAgain,
  recordOutcome,
  rsvp,
  setPlanTime,
  type PlansStore,
} from '../_shared/api/plans.ts';

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
    notifyStore?: NotifyStore;
    plansStore?: PlansStore;
    cronSecret?: string;
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
  app.post('/picks', async (c) => {
    const user = await deps.getUser(c.req.raw);
    const body = await readJsonBody(c);
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
    const body = await readJsonBody(c);
    return c.json(await cancelPick(deps.lifecycleStore, c.req.param('id'), user.id, body));
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
  // My inbox (newest 50) and push registration. Always the verified caller's own rows.
  app.get('/notifications', async (c) => {
    c.header('Cache-Control', 'private, no-store');
    const user = await deps.getUser(c.req.raw);
    return c.json(await listNotifications(requireNotify(), user.id));
  });
  app.post('/notifications/:id/read', async (c) => {
    const user = await deps.getUser(c.req.raw);
    return c.json(await markNotificationRead(requireNotify(), c.req.param('id'), user.id));
  });
  app.post('/push-tokens', async (c) => {
    const user = await deps.getUser(c.req.raw);
    const body = await readJsonBody(c);
    return c.json(await registerPushToken(requireNotify(), user.id, body));
  });
  app.post('/push-tokens/remove', async (c) => {
    const user = await deps.getUser(c.req.raw);
    const body = await readJsonBody(c);
    return c.json(await unregisterPushToken(requireNotify(), user.id, body));
  });
  // After the winner: plan time, RSVP, "Did you go?", reasons, history, Pick again.
  // Membership, host and state are rechecked inside each RPC (0013_plans_rsvp.sql).
  app.get('/picks/:id/plan', async (c) => {
    c.header('Cache-Control', 'private, no-store');
    const user = await deps.getUser(c.req.raw);
    return c.json(await getPlan(requirePlans(), c.req.param('id'), user.id));
  });
  app.get('/picks/:id/reasons', async (c) => {
    const user = await deps.getUser(c.req.raw);
    return c.json(await getReasons(requirePlans(), c.req.param('id'), user.id));
  });
  app.post('/picks/:id/plan-time', async (c) => {
    const user = await deps.getUser(c.req.raw);
    const body = await readJsonBody(c);
    return c.json(await setPlanTime(requirePlans(), c.req.param('id'), user.id, body));
  });
  app.post('/picks/:id/rsvp', async (c) => {
    const user = await deps.getUser(c.req.raw);
    const body = await readJsonBody(c);
    return c.json(await rsvp(requirePlans(), c.req.param('id'), user.id, body));
  });
  app.post('/picks/:id/outcome', async (c) => {
    const user = await deps.getUser(c.req.raw);
    const body = await readJsonBody(c);
    return c.json(await recordOutcome(requirePlans(), c.req.param('id'), user.id, body));
  });
  app.post('/picks/:id/again', async (c) => {
    const user = await deps.getUser(c.req.raw);
    return c.json(await pickAgain(requirePlans(), c.req.param('id'), user.id), 201);
  });
  app.get('/history', async (c) => {
    c.header('Cache-Control', 'private, no-store');
    const user = await deps.getUser(c.req.raw);
    return c.json(await getHistory(requirePlans(), user.id));
  });
  app.get('/groups/:id/history', async (c) => {
    c.header('Cache-Control', 'private, no-store');
    const user = await deps.getUser(c.req.raw);
    return c.json(await getHistory(requirePlans(), user.id, c.req.param('id')));
  });
  function requirePlans(): PlansStore {
    if (!deps.plansStore) throw new ApiError(503, 'NOT_CONFIGURED', 'Plans are not available');
    return deps.plansStore;
  }
  function requireNotify(): NotifyStore {
    if (!deps.notifyStore) {
      throw new ApiError(503, 'NOT_CONFIGURED', 'Notifications are not available');
    }
    return deps.notifyStore;
  }
  return app;
}
