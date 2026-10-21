import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
// local.mjs is Josh's harness from josh/sweep-ci; it resolves once that branch merges.
// eslint-disable-next-line import/no-unresolved
import { localConfig, request, requireStatus } from './local.mjs';

// The whole MVP loop over real HTTP -> Auth -> Edge Function -> RPCs -> local Postgres,
// with 4 users and fixed answers (Week 4, Alan). Uses Josh's harness (local.mjs).
// "Join by code" is Razin's POST /join, not built yet: participants are inserted with
// the service role as a stand-in. Swap in POST /join once it lands.
// The same scenarios were checked against the real TS + SQL on Postgres (PGlite) first.
test('MVP loop: create -> join -> start -> swipe -> close -> winner / tied vote', { timeout: 180_000 }, async (t) => {
  const config = localConfig();
  const run = randomUUID();
  const users = [];
  const picks = [];
  const db = (path, options = {}) =>
    request(config, `/rest/v1/${path}`, { ...options, key: config.service, token: config.service });
  const read = async (path) => requireStatus(await db(path), 200, 'database verification');
  const api = (method, path, token, body) =>
    request(config, `/functions/v1/api${path}`, { method, token, body });

  async function user(role) {
    const password = `Test-only-${randomUUID()}!`;
    const email = `wtw-loop-${run}-${role}@example.com`;
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

  /** Host creates + starts a Pick with three joined members; returns its sorted candidate ids. */
  async function startedPick(host, members, extra = {}) {
    const created = requireStatus(
      await api('POST', '/picks', host.token, {
        category: 'food',
        center: { lat: 40.9126, lng: -73.1234 },
        radiusM: 10_000,
        poolSize: 10,
        deadlineAt: null,
        closeThreshold: 100,
        ...extra,
      }),
      201,
      'create Pick',
    );
    assert.equal(created.state, 'draft');
    picks.push(created.pickId);
    // Stand-in for POST /join (Razin).
    requireStatus(
      await db('pick_participants', {
        method: 'POST',
        body: members.map((m) => ({ pick_id: created.pickId, user_id: m.id })),
      }),
      201,
      'join members',
    );
    requireStatus(await api('POST', `/picks/${created.pickId}/start`, host.token), 200, 'start');
    const view = requireStatus(await api('GET', `/picks/${created.pickId}`, host.token), 200, 'get Pick');
    const ids = view.candidates.map((c) => c.placeId).sort();
    assert.ok(ids.length >= 2, 'the pool has at least 2 places');
    return { pickId: created.pickId, ids };
  }
  const swipe = (pickId, u, placeId, value) =>
    api('POST', `/picks/${pickId}/swipes`, u.token, { placeId, value }).then((r) =>
      requireStatus(r, 200, 'swipe'),
    );
  const stateOf = async (pickId, u) =>
    requireStatus(await api('GET', `/picks/${pickId}`, u.token), 200, 'get Pick');

  try {
    const host = await user('host');
    const [u2, u3, u4] = [await user('u2'), await user('u3'), await user('u4')];
    const outsider = await user('outsider');
    const everyone = [host, u2, u3, u4];

    await t.test('clear winner; one person never answers (counts as Maybe)', async () => {
      const { pickId, ids } = await startedPick(host, [u2, u3, u4]);
      const [first, ...rest] = ids;
      for (const u of [host, u2, u3]) {
        await swipe(pickId, u, first, 2);
        for (const r of rest) await swipe(pickId, u, r, 0);
      }
      assert.equal((await stateOf(pickId, host)).state, 'swiping', 'u4 has not finished: no auto-close');

      requireStatus(await api('POST', `/picks/${pickId}/close`, u2.token), 403, 'participant close');
      const closed = requireStatus(await api('POST', `/picks/${pickId}/close`, host.token), 200, 'host close');
      assert.deepEqual(closed, { state: 'completed', winnerPlaceId: first, finalists: [] });
      assert.ok(!JSON.stringify(closed).includes('score'), 'scores never leave the server');

      // "Reopen the app": the saved result is still there for every participant.
      const reopened = await stateOf(pickId, u4);
      assert.equal(reopened.state, 'completed');
      assert.equal(reopened.winnerPlaceId, first);
      assert.equal(reopened.decidedBy, 'clear_winner');
      const ranks = await read(`ranking_results?pick_id=eq.${pickId}&select=place_id,rank&order=rank`);
      assert.equal(ranks[0].place_id, first);

      requireStatus(await api('POST', `/picks/${pickId}/close`, outsider.token), 403, 'outsider reads result');
      assert.deepEqual(
        requireStatus(await api('POST', `/picks/${pickId}/close`, host.token), 200, 'idempotent re-close'),
        closed,
      );
    });

    await t.test('everyone ties -> auto-close -> 2-2 vote -> tie-break to the better rank', async () => {
      const { pickId, ids } = await startedPick(host, [u2, u3, u4]);
      for (const u of everyone) for (const id of ids) await swipe(pickId, u, id, 2);

      const [stored] = await read(`picks?id=eq.${pickId}&select=state,vote_deadline_at`);
      assert.equal(stored.state, 'final_vote', 'the last swipe closed it into a vote');
      assert.ok(stored.vote_deadline_at, 'the vote has its own deadline');
      const finalists = (
        await read(`ranking_results?pick_id=eq.${pickId}&finalist=eq.true&select=place_id&order=rank`)
      ).map((r) => r.place_id);
      assert.deepEqual([...finalists].sort(), ids, 'everyone tied at #1, so all are finalists');
      const [top, second] = finalists;

      const vote = (u, placeId, status = 200) =>
        api('POST', `/picks/${pickId}/vote`, u.token, { placeId }).then((r) =>
          requireStatus(r, status, `vote ${placeId}`),
        );
      await vote(u2, 'not-a-finalist', 400);
      await vote(outsider, top, 403);
      await vote(host, second);
      await vote(host, top); // a vote can be changed until the vote closes
      await vote(u2, top);
      await vote(u3, second);
      assert.equal((await stateOf(pickId, host)).state, 'final_vote', '3 of 4 voted: still open');
      await vote(u4, second);

      const done = await stateOf(pickId, u3);
      assert.equal(done.state, 'completed', 'the last ballot settles the vote');
      assert.equal(done.winnerPlaceId, top, '2-2 tie goes to the better rank (score, distance, id)');
      assert.equal(done.decidedBy, 'tie_break');
      await vote(u2, top, 409);
    });

    await t.test('a refresh after swipes needs confirm and clears every answer', async () => {
      const { pickId, ids } = await startedPick(host, [u2, u3, u4]);
      await swipe(pickId, u2, ids[0], 2);
      requireStatus(await api('POST', `/picks/${pickId}/refresh`, host.token, {}), 409, 'refresh w/o confirm');
      requireStatus(
        await api('POST', `/picks/${pickId}/refresh`, host.token, { confirm: true }),
        200,
        'confirmed refresh',
      );
      assert.deepEqual((await stateOf(pickId, u2)).myAnswers, {});
    });

    await t.test('the host leaving does not stall it: 3 of 4 done meets a 75% threshold', async () => {
      const { pickId, ids } = await startedPick(host, [u2, u3, u4], { closeThreshold: 75 });
      for (const u of [u2, u3, u4]) for (const id of ids) await swipe(pickId, u, id, id === ids[0] ? 2 : 0);
      assert.equal((await stateOf(pickId, host)).state, 'completed');
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
    if (failed) throw new Error('Local fixture cleanup failed; reset the local database before retrying');
  }
});
