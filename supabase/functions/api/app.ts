import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { ApiError, errorResponse } from '../_shared/api/errors.ts';
import { rank, swipe, type HeartbeatStore } from '../_shared/api/heartbeat.ts';

export function createApp(
  deps: {
    getUser(req: Request): Promise<{ id: string }>;
    store: HeartbeatStore;
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
  app.post('/picks/:id/swipes', async (c) => {
    const user = await deps.getUser(c.req.raw);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw new ApiError(400, 'INVALID_JSON', 'Request body must be valid JSON');
    }
    return c.json(await swipe(deps.store, c.req.param('id'), user.id, body));
  });
  app.post('/picks/:id/rank', async (c) => {
    const user = await deps.getUser(c.req.raw);
    return c.json(await rank(deps.store, c.req.param('id'), user.id));
  });
  return app;
}
