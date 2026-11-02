import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig, request, requireStatus } from './local.mjs';

// DELETE /me over real HTTP -> Auth -> Edge Function -> Auth admin API -> local Postgres
// (Razin, M4, 0017). Ava hosts one Pick still swiping and one completed, and is in Ben's
// completed Pick. After she deletes her account: nothing of hers is readable, her session
// is dead, her unfinished Pick is canceled for Ben, and both completed Picks still exist.
test(
  'DELETE /me: account and data gone, hosted Picks canceled or kept, others intact',
  { timeout: 180_000 },
  async () => {
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
      const email = `wtw-account-${run}-${role}@example.com`;
      const created = requireStatus(
        await request(config, '/auth/v1/admin/users', {
          method: 'POST',
          key: config.service,
          token: config.service,
          body: { email, password, email_confirm: true, user_metadata: { display_name: role } },
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
      return { id: created.id, token: session.access_token, refresh: session.refresh_token };
    }

    async function startedPick(host, members) {
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
      for (const m of members)
        requireStatus(await api('POST', '/picks/join', m.token, { code }), 200, 'join');
      requireStatus(await api('POST', `/picks/${created.pickId}/start`, host.token), 200, 'start');
      const view = requireStatus(
        await api('GET', `/picks/${created.pickId}`, host.token),
        200,
        'get Pick',
      );
      return { pickId: created.pickId, ids: view.candidates.map((c) => c.placeId).sort() };
    }
    /** Everyone answers: the first place Yes, the rest No. Auto-closes at 100%. */
    async function completedPick(host, members) {
      const { pickId, ids } = await startedPick(host, members);
      for (const u of [host, ...members]) {
        for (const id of ids) {
          requireStatus(
            await api('POST', `/picks/${pickId}/swipes`, u.token, {
              placeId: id,
              value: id === ids[0] ? 2 : 0,
            }),
            200,
            'swipe',
          );
        }
      }
      const view = requireStatus(await api('GET', `/picks/${pickId}`, host.token), 200, 'get Pick');
      assert.equal(view.state, 'completed');
      assert.equal(view.winnerPlaceId, ids[0]);
      return pickId;
    }

    try {
      const ava = await user('Ava');
      const ben = await user('Ben');
      const cy = await user('Cy');

      const avaSwiping = (await startedPick(ava, [ben])).pickId;
      const avaDone = await completedPick(ava, [ben]);
      const benDone = await completedPick(ben, [ava, cy]);
      const benRanks = (await read(`ranking_results?pick_id=eq.${benDone}&select=place_id`)).length;
      assert.ok(benRanks > 0);

      // Push tokens arrive with 0009 (PR #31); register one when the table exists.
      const tokens = await db(`push_tokens?select=token&limit=1`);
      const hasPushTokens = tokens.status === 200;
      if (hasPushTokens) {
        requireStatus(
          await db('push_tokens', {
            method: 'POST',
            body: {
              token: `ExponentPushToken[acct-${run.slice(0, 8)}]`,
              user_id: ava.id,
              platform: 'ios',
            },
          }),
          201,
          'seed push token',
        );
      }

      // ------------------------------------------------------------------ delete
      requireStatus(await api('DELETE', '/me', undefined), 401, 'DELETE /me without a token');
      assert.deepEqual(requireStatus(await api('DELETE', '/me', ava.token), 200, 'DELETE /me'), {
        status: 'ok',
      });

      // Her session no longer works.
      requireStatus(
        await api('GET', `/picks/${benDone}`, ava.token),
        401,
        'API with the old token',
      );
      requireStatus(
        await api('DELETE', '/me', ava.token),
        401,
        'second DELETE /me with the old token',
      );
      const refreshed = await request(config, '/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        body: { refresh_token: ava.refresh },
      });
      assert.ok(refreshed.status >= 400 && refreshed.status < 500, 'the refresh token is revoked');
      requireStatus(
        await request(config, `/auth/v1/admin/users/${ava.id}`, {
          key: config.service,
          token: config.service,
        }),
        404,
        'Auth user lookup',
      );

      // Nothing of hers is readable, with her old token or by anyone.
      // A readable column each, not select=*: clients have no grant on profiles' survey columns.
      for (const [table, column] of [
        ['picks', 'id'],
        ['profiles', 'id'],
        ['pick_participants', 'pick_id'],
        ['preferences', 'pick_id'],
      ]) {
        const rows = requireStatus(
          await request(config, `/rest/v1/${table}?select=${column}`, { token: ava.token }),
          200,
          `read ${table} with the old token`,
        );
        assert.deepEqual(rows, [], `old token reads no ${table}`);
      }
      assert.deepEqual(await read(`profiles?id=eq.${ava.id}&select=id`), []);
      assert.deepEqual(await read(`pick_participants?user_id=eq.${ava.id}&select=pick_id`), []);
      assert.deepEqual(await read(`preferences?user_id=eq.${ava.id}&select=pick_id`), []);
      assert.deepEqual(await read(`final_votes?user_id=eq.${ava.id}&select=pick_id`), []);
      assert.deepEqual(await read(`picks?host_id=eq.${ava.id}&select=id`), []);
      if (hasPushTokens)
        assert.deepEqual(await read(`push_tokens?user_id=eq.${ava.id}&select=token`), []);

      // Her unfinished Pick: canceled, and Ben sees it that way.
      const canceled = requireStatus(
        await api('GET', `/picks/${avaSwiping}`, ben.token),
        200,
        'Ben reads it',
      );
      assert.equal(canceled.state, 'canceled');
      assert.equal(canceled.hostDeleted, true);
      const progress = requireStatus(
        await api('GET', `/picks/${avaSwiping}/progress`, ben.token),
        200,
        'progress',
      );
      assert.equal(progress.hostDeleted, true);
      assert.deepEqual(
        progress.participants.map((p) => p.displayName),
        ['Ben'],
      );
      requireStatus(
        await api('POST', `/picks/${avaSwiping}/cancel`, ben.token),
        403,
        'Ben is not the host',
      );

      // Her completed Pick: kept with its winner, no host.
      const kept = requireStatus(
        await api('GET', `/picks/${avaDone}`, ben.token),
        200,
        'Ben reads her result',
      );
      assert.equal(kept.state, 'completed');
      assert.ok(kept.winnerPlaceId);
      assert.equal(kept.hostDeleted, true);
      assert.equal(kept.isHost, false);

      // Ben's completed Pick: untouched, for Ben and for Cy.
      for (const u of [ben, cy]) {
        const view = requireStatus(
          await api('GET', `/picks/${benDone}`, u.token),
          200,
          "read Ben's Pick",
        );
        assert.equal(view.state, 'completed');
        assert.ok(view.winnerPlaceId);
        assert.equal(view.hostDeleted, false);
        assert.equal(view.participantCount, 2);
      }
      assert.equal(
        (await read(`ranking_results?pick_id=eq.${benDone}&select=place_id`)).length,
        benRanks,
      );
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
        const response = await request(config, `/auth/v1/admin/users/${id}`, {
          method: 'DELETE',
          key: config.service,
          token: config.service,
        });
        // 404: deleted by the test itself.
        if (response.status !== 200 && response.status !== 404) failed = true;
      }
      if (failed)
        throw new Error('Local fixture cleanup failed; reset the local database before retrying');
    }
  },
);
