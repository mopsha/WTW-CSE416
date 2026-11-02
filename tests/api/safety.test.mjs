import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig, request, requireStatus } from './local.mjs';

// Invites and safety over real HTTP -> Auth -> Edge Function -> 0014 RPCs -> local Postgres
// (Razin, M4): join brute-force limit, identical join failures, lobby lock, blocks, invite
// links (create, accept, revoke) and reports.
test(
  'invites and safety: join limits, lock, blocks, invite links, reports',
  { timeout: 180_000 },
  async (t) => {
    const config = localConfig();
    const run = randomUUID();
    const users = [];
    const picks = [];
    const db = (path, options = {}) =>
      request(config, `/rest/v1/${path}`, {
        ...options,
        key: config.service,
        token: config.service,
      });
    const read = async (path) => requireStatus(await db(path), 200, 'database verification');
    const api = (method, path, token, body) =>
      request(config, `/functions/v1/api${path}`, { method, token, body });

    async function user(role) {
      const password = `Test-only-${randomUUID()}!`;
      const email = `wtw-safety-${run}-${role}@example.com`;
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
    async function draft(host) {
      const created = requireStatus(
        await api('POST', '/picks', host.token, {
          category: 'food',
          center: { lat: 40.9126, lng: -73.1234 },
          radiusM: 10_000,
          poolSize: 5,
          deadlineAt: null,
          closeThreshold: 100,
        }),
        201,
        'create Pick',
      );
      picks.push(created.pickId);
      const [{ code }] = await read(`pick_join_codes?pick_id=eq.${created.pickId}&select=code`);
      return { pickId: created.pickId, code };
    }
    const join = (u, code) => api('POST', '/picks/join', u.token, { code });

    try {
      const host = await user('host');
      const guest = await user('guest');
      const prober = await user('prober');
      const blocked = await user('blocked');
      const friend = await user('friend');
      const main = await draft(host);
      const canceled = await draft(host);
      requireStatus(
        await api('POST', `/picks/${canceled.pickId}/cancel`, host.token),
        200,
        'cancel',
      );

      await t.test(
        'every failed join looks the same, then 10 failures an hour is 429',
        async () => {
          const unknown = await join(prober, 'ZZZZZZ');
          const closed = await join(prober, canceled.code);
          assert.equal(unknown.status, 404);
          assert.deepEqual(closed, unknown, 'a closed Pick and an unknown code answer identically');
          for (let i = 0; i < 8; i++) assert.equal((await join(prober, 'YYYYYY')).status, 404);
          const limited = await join(prober, main.code);
          assert.equal(limited.status, 429, 'the 11th try is limited even with a valid code');
          assert.equal(limited.data.error.code, 'RATE_LIMITED');
          requireStatus(await join(guest, main.code), 200, 'the limit is per user');
        },
      );

      await t.test(
        'the host locks the lobby; nobody new gets in until it is unlocked',
        async () => {
          requireStatus(
            await api('POST', `/picks/${main.pickId}/lock`, guest.token, { locked: true }),
            403,
            'guest lock',
          );
          assert.deepEqual(
            requireStatus(
              await api('POST', `/picks/${main.pickId}/lock`, host.token, { locked: true }),
              200,
              'lock',
            ),
            { locked: true },
          );
          const refused = await join(friend, main.code);
          assert.equal(refused.status, 404);
          assert.equal(refused.data.error.code, 'JOIN_CODE_NOT_FOUND');
          requireStatus(await join(guest, main.code), 200, 'someone already in can reopen it');
          requireStatus(
            await api('POST', `/picks/${main.pickId}/lock`, host.token, { locked: false }),
            200,
            'unlock',
          );
          requireStatus(await join(friend, main.code), 200, 'join after unlocking');
        },
      );

      await t.test(
        'blocking: no joining by code or link; only the blocker sees the block',
        async () => {
          requireStatus(await api('POST', `/blocks/${blocked.id}`, host.token), 200, 'block');
          requireStatus(await api('POST', `/blocks/${host.id}`, host.token), 400, 'block yourself');
          const byCode = await join(blocked, main.code);
          assert.equal(byCode.status, 404);
          assert.equal(byCode.data.error.code, 'JOIN_CODE_NOT_FOUND', 'not told they were blocked');
          const link = requireStatus(
            await api('POST', '/invites', host.token, { kind: 'pick', targetId: main.pickId }),
            201,
            'create link',
          );
          requireStatus(
            await api('POST', `/invites/${link.token}/accept`, blocked.token),
            404,
            'blocked link',
          );

          const mine = requireStatus(
            await request(config, '/rest/v1/blocks?select=blocked_id', { token: host.token }),
            200,
            'read blocks',
          );
          assert.deepEqual(mine, [{ blocked_id: blocked.id }]);
          const theirs = requireStatus(
            await request(config, '/rest/v1/blocks?select=blocker_id', { token: blocked.token }),
            200,
            'read blocks',
          );
          assert.deepEqual(theirs, []);

          requireStatus(
            await api('POST', `/blocks/${blocked.id}/remove`, host.token),
            200,
            'unblock',
          );
          requireStatus(
            await api('POST', `/invites/${link.token}/accept`, blocked.token),
            200,
            'after unblocking',
          );
        },
      );

      await t.test(
        'invite links: create, accept, revoke; unusable links look the same',
        async () => {
          requireStatus(
            await api('POST', '/invites', guest.token, { kind: 'pick', targetId: main.pickId }),
            403,
            'guest link',
          );
          const link = requireStatus(
            await api('POST', '/invites', host.token, {
              kind: 'pick',
              targetId: main.pickId,
              maxUses: 5,
            }),
            201,
            'create link',
          );
          assert.match(link.token, /^[A-Za-z0-9_-]{22}$/);
          assert.equal(link.url, `wtw://i/${link.token}`);
          assert.equal(link.maxUses, 5);

          const newcomer = await user('newcomer');
          assert.deepEqual(
            requireStatus(
              await api('POST', `/invites/${link.token}/accept`, newcomer.token),
              200,
              'accept',
            ),
            { kind: 'pick', targetId: main.pickId },
          );
          const progress = requireStatus(
            await api('GET', `/picks/${main.pickId}/progress`, newcomer.token),
            200,
            'progress',
          );
          assert.ok(
            progress.participants.some((p) => p.isMe),
            'the link put them in the Pick',
          );

          requireStatus(
            await api('DELETE', `/invites/${link.token}`, guest.token),
            404,
            'someone else revokes',
          );
          requireStatus(await api('DELETE', `/invites/${link.token}`, host.token), 200, 'revoke');
          const late = await user('late');
          const revoked = await api('POST', `/invites/${link.token}/accept`, late.token);
          const malformed = await api('POST', '/invites/not-a-token/accept', late.token);
          assert.equal(revoked.status, 404);
          assert.deepEqual(malformed, revoked, 'a malformed and a revoked link answer identically');
          const [stored] = await read(`invite_links?token=eq.${link.token}&select=uses,revoked_at`);
          assert.equal(stored.uses, 1);
          assert.ok(stored.revoked_at);
        },
      );

      await t.test('reports: validated, private, 10 a day', async () => {
        requireStatus(
          await api('POST', '/reports', guest.token, {
            kind: 'user',
            targetId: host.id,
            reason: 'Rude',
          }),
          201,
          'report',
        );
        requireStatus(
          await api('POST', '/reports', guest.token, {
            kind: 'pick',
            targetId: main.pickId,
            reason: 'Spam',
          }),
          201,
          'report Pick',
        );
        requireStatus(
          await api('POST', '/reports', prober.token, {
            kind: 'pick',
            targetId: main.pickId,
            reason: 'x',
          }),
          404,
          'not in it',
        );
        requireStatus(
          await api('POST', '/reports', guest.token, {
            kind: 'user',
            targetId: host.id,
            reason: '',
          }),
          400,
          'no reason',
        );
        for (let i = 0; i < 8; i++) {
          requireStatus(
            await api('POST', '/reports', guest.token, {
              kind: 'user',
              targetId: host.id,
              reason: `r${i}`,
            }),
            201,
            'report',
          );
        }
        requireStatus(
          await api('POST', '/reports', guest.token, {
            kind: 'user',
            targetId: host.id,
            reason: 'one more',
          }),
          429,
          '11th',
        );
        const asClient = await request(config, '/rest/v1/reports?select=id', {
          token: guest.token,
        });
        assert.notEqual(asClient.status, 200, 'clients cannot read reports');
        assert.equal((await read(`reports?reporter_id=eq.${guest.id}&select=id`)).length, 10);
      });
    } finally {
      let failed = false;
      for (const id of picks) {
        try {
          requireStatus(await db(`picks?id=eq.${id}`, { method: 'DELETE' }), 204, 'cleanup Pick');
        } catch {
          failed = true;
        }
      }
      for (const id of users) {
        try {
          requireStatus(
            await request(config, `/auth/v1/admin/users/${id}`, {
              method: 'DELETE',
              key: config.service,
              token: config.service,
            }),
            200,
            'cleanup user',
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
