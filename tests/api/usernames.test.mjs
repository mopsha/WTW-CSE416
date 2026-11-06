import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig, request, requireStatus } from './local.mjs';

test(
  'username identity, discovery, friendship, blocking and shared-ID lookup on the real stack',
  { timeout: 60000 },
  async () => {
    const config = localConfig();
    const users = [];
    const prefix = 'u' + randomUUID().replaceAll('-', '').slice(0, 12);
    const api = (path, token, method = 'GET', body) =>
      request(config, `/functions/v1/api${path}`, { token, method, body });
    async function user(n) {
      const email = `${prefix}-${n}@example.invalid`,
        password = `Test-${randomUUID()}!`;
      const made = requireStatus(
        await request(config, '/auth/v1/admin/users', {
          method: 'POST',
          key: config.service,
          token: config.service,
          body: { email, password, email_confirm: true },
        }),
        200,
        'create local username user',
      );
      users.push(made.id);
      const session = requireStatus(
        await request(config, '/auth/v1/token?grant_type=password', {
          method: 'POST',
          body: { email, password },
        }),
        200,
        'sign in local username user',
      );
      return { id: made.id, token: session.access_token };
    }
    try {
      const a = await user(1),
        b = await user(2);
      requireStatus(
        await api('/me/identity', a.token, 'POST', {
          displayName: 'One',
          username: `${prefix}_one`,
        }),
        200,
        'complete identity one',
      );
      requireStatus(
        await api('/me/identity', b.token, 'POST', {
          displayName: 'Two',
          username: `${prefix}_two`,
        }),
        200,
        'complete identity two',
      );
      requireStatus(
        await api('/me/identity', b.token, 'POST', {
          displayName: 'Should not change',
          username: `${prefix}_ONE`,
        }),
        409,
        'case-insensitive duplicate',
      );
      requireStatus(
        await api('/me/identity', b.token, 'POST', { displayName: 'Two', username: 'support' }),
        400,
        'reserved handle',
      );
      for (const email of [prefix + '-2@example.invalid', prefix + '-missing@example.invalid']) {
        requireStatus(
          await api('/friends/requests', a.token, 'POST', { email }),
          410,
          'retired email probe',
        );
      }
      assert.equal(
        requireStatus(await api('/people/' + b.id, a.token), 200, 'identity after probes')
          .relationship,
        'none',
      );
      let found = requireStatus(
        await api(`/friends/search?q=%40${prefix.toUpperCase()}`, a.token),
        200,
        'search by @prefix',
      ).people;
      assert.equal(found.length, 1);
      assert.equal(found[0].userId, b.id);
      assert.equal(found[0].relationship, 'none');
      assert.equal('email' in found[0], false);
      assert.equal('favoriteCuisine' in found[0], false);
      requireStatus(
        await api('/friends/username-requests', a.token, 'POST', {
          username: `@${prefix}_TWO`,
          targetId: b.id,
        }),
        200,
        'request by username',
      );
      requireStatus(
        await api('/friends/username-requests', a.token, 'POST', {
          username: `${prefix}_two`,
          targetId: b.id,
        }),
        200,
        'duplicate request',
      );
      assert.equal(
        requireStatus(await api(`/people/${b.id}`, a.token), 200, 'outgoing identity').relationship,
        'requested',
      );
      assert.equal(
        requireStatus(await api(`/people/${a.id}`, b.token), 200, 'incoming identity').relationship,
        'incoming',
      );
      requireStatus(
        await api(`/friends/${a.id}/accept`, b.token, 'POST', {}),
        200,
        'accept request',
      );
      assert.equal(
        requireStatus(await api(`/people/${b.id}`, a.token), 200, 'friend identity').relationship,
        'friends',
      );
      requireStatus(
        await api('/me/details', b.token, 'POST', {
          username: `${prefix}_new`,
          favoriteCuisine: null,
          favoriteActivity: null,
          shareMetadata: false,
        }),
        200,
        'change username',
      );
      assert.equal(
        requireStatus(await api(`/people/${b.id}`, a.token), 200, 'stable shared ID after rename')
          .username,
        `${prefix}_new`,
      );
      requireStatus(await api(`/blocks/${b.id}`, a.token, 'POST', {}), 200, 'block peer');
      assert.deepEqual(
        requireStatus(await api(`/friends/search?q=${prefix}`, a.token), 200, 'blocked search')
          .people,
        [],
      );
      requireStatus(await api(`/people/${b.id}`, a.token), 404, 'blocked shared identity');
      requireStatus(await api(`/people/${a.id}`, b.token), 404, 'reverse blocked identity');
      requireStatus(
        await api('/friends/username-requests', a.token, 'POST', {
          username: prefix + '_two',
          targetId: b.id,
        }),
        404,
        'blocked and stale target cannot report success',
      );
      requireStatus(
        await api('/friends/username-requests', a.token, 'POST', {
          username: prefix + '_one',
          targetId: a.id,
        }),
        400,
        'self request rejected',
      );
      let exhausted = false;
      for (let i = 0; i <= 30; i++) {
        const response = await api('/people/' + b.id, a.token);
        if (response.status === 429) {
          exhausted = true;
          break;
        }
        requireStatus(response, 404, 'missing or blocked identity spends quota');
      }
      assert.equal(exhausted, true);
      requireStatus(
        await api('/friends/search?q=' + prefix, a.token),
        429,
        'cross-route shared quota',
      );
      requireStatus(await api('/friends/search?q=' + prefix), 401, 'anonymous discovery');
    } finally {
      for (const id of users)
        requireStatus(
          await request(config, `/auth/v1/admin/users/${id}`, {
            method: 'DELETE',
            key: config.service,
            token: config.service,
          }),
          200,
          'delete local username fixture',
        );
    }
  },
);
