import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig, request, requireStatus } from './local.mjs';

// Real HTTP -> verified caller -> PostgREST cursor predicates -> PostgreSQL.
// Service-role inserts are fixture setup only; assertions use the public API.
test(
  'local inbox pagination: boundaries, ordering, precision and caller isolation',
  { timeout: 120_000 },
  async () => {
    const config = localConfig();
    const run = randomUUID();
    const users = [];
    const db = (path, options = {}) =>
      request(config, `/rest/v1/${path}`, {
        ...options,
        key: config.service,
        token: config.service,
      });
    const inbox = (token, before) =>
      request(
        config,
        `/functions/v1/api/notifications${
          before === undefined ? '' : `?before=${encodeURIComponent(before)}`
        }`,
        { token },
      );
    async function user(role) {
      const password = `Test-only-${randomUUID()}!`;
      const email = `wtw-inbox-${run}-${role}@example.com`;
      const created = requireStatus(
        await request(config, '/auth/v1/admin/users', {
          method: 'POST',
          key: config.service,
          token: config.service,
          body: { email, password, email_confirm: true },
        }),
        200,
        'create local user',
      );
      users.push(created.id);
      const session = requireStatus(
        await request(config, '/auth/v1/token?grant_type=password', {
          method: 'POST',
          body: { email, password },
        }),
        200,
        'sign in local user',
      );
      return { id: created.id, token: session.access_token };
    }
    try {
      const owner = await user('owner');
      const other = await user('other');
      // 55 identical microsecond timestamps force an ID tie-break across page one.
      const fixtures = Array.from({ length: 101 }, (_, i) => ({
        id: randomUUID(),
        user_id: owner.id,
        type: 'reminder',
        payload: {},
        created_at:
          i < 55
            ? '2026-11-03T12:00:00.123456+00:00'
            : new Date(Date.UTC(2026, 10, 2, 12, 0, 101 - i)).toISOString(),
      }));
      fixtures.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
      const foreign = {
        id: randomUUID(),
        user_id: other.id,
        type: 'reminder',
        payload: {},
        created_at: '2031-01-01T00:00:00Z',
      };
      requireStatus(
        await db('notifications', {
          method: 'POST',
          body: [...fixtures].reverse().concat(foreign),
        }),
        201,
        'seed notification fixtures',
      );

      const first = requireStatus(await inbox(owner.token), 200, 'first inbox page');
      assert.equal(first.notifications.length, 50);
      assert.equal(first.unreadCount, 50);
      assert.deepEqual(
        first.notifications.map((n) => n.id),
        fixtures.slice(0, 50).map((n) => n.id),
      );
      assert.match(first.nextCursor, /\.123456(?:\+00:00|Z)\|/);
      const boundary = first.notifications.at(-1);
      assert.equal(first.nextCursor, `${boundary.createdAt}|${boundary.id}`);
      requireStatus(
        await request(config, `/functions/v1/api/notifications/${boundary.id}/read`, {
          method: 'POST',
          token: owner.token,
        }),
        200,
        'mark page boundary read',
      );
      // A newer insertion must not shift the cursor and repeat/skip older rows.
      requireStatus(
        await db('notifications', {
          method: 'POST',
          body: {
            id: randomUUID(),
            user_id: owner.id,
            type: 'reminder',
            payload: {},
            created_at: '2030-01-01T00:00:00Z',
          },
        }),
        201,
        'new notice between pages',
      );
      const second = requireStatus(
        await inbox(owner.token, first.nextCursor),
        200,
        'second inbox page',
      );
      const third = requireStatus(
        await inbox(owner.token, second.nextCursor),
        200,
        'last inbox page',
      );
      assert.equal(second.notifications.length, 50);
      assert.equal(third.notifications.length, 1);
      assert.equal(third.nextCursor, null);
      const pages = [...first.notifications, ...second.notifications, ...third.notifications];
      assert.deepEqual(
        pages.map((n) => n.id),
        fixtures.map((n) => n.id),
        'newest first with UUID descending on ties, with no skipped boundaries',
      );
      assert.equal(new Set(pages.map((n) => n.id)).size, 101, 'no duplicates across pages');
      const last = pages.at(-1);
      const empty = requireStatus(
        await inbox(owner.token, `${last.createdAt}|${last.id}`),
        200,
        'past end',
      );
      assert.deepEqual(empty.notifications, []);
      assert.equal(empty.nextCursor, null);

      const theirs = requireStatus(await inbox(other.token), 200, 'other user inbox');
      assert.deepEqual(
        theirs.notifications.map((n) => n.id),
        [foreign.id],
      );
      const crossUser = requireStatus(
        await inbox(other.token, first.nextCursor),
        200,
        'cursor conveys no authorization',
      );
      assert.deepEqual(crossUser.notifications, []);
      requireStatus(await inbox(undefined, first.nextCursor), 401, 'anonymous cursor');
      requireStatus(await inbox('invalid-token', first.nextCursor), 401, 'invalid bearer token');
      for (const cursor of [
        '',
        'bad',
        '2026-11-03T12:00:00Z|bad',
        `${first.nextCursor}|extra`,
        '2026-11-03T12:00:00Z|id),user_id.neq.null',
      ]) {
        requireStatus(await inbox(owner.token, cursor), 400, 'malformed cursor');
      }
      requireStatus(await inbox(undefined, 'bad'), 401, 'authenticate before cursor validation');
    } finally {
      let failed = false;
      for (const id of users) {
        try {
          requireStatus(
            await request(config, `/auth/v1/admin/users/${id}`, {
              method: 'DELETE',
              key: config.service,
              token: config.service,
            }),
            200,
            'cleanup user and cascading inbox fixtures',
          );
        } catch {
          failed = true;
        }
      }
      if (failed)
        throw new Error('Local fixture cleanup failed; reset the local database before retrying');
    }
  },
);
