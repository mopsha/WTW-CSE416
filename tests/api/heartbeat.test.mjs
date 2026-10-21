import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig, request, requireStatus } from './local.mjs';

// Real HTTP -> Auth verification -> Edge Function -> RPC -> local Postgres.
// Kept outside Jest's *.test.ts pattern; no app mocks or provider credentials.
test('local heartbeat integration', { timeout: 120_000 }, async (t) => {
  const config = localConfig();
  const users = [],
    picks = [],
    places = [];
  const run = randomUUID();
  const db = (path, options = {}) =>
    request(config, `/rest/v1/${path}`, {
      ...options,
      key: config.service,
      token: config.service,
    });
  const insert = async (table, rows) =>
    requireStatus(await db(table, { method: 'POST', body: rows }), 201, `fixture ${table}`);
  const api = (path, token, body) =>
    request(config, `/functions/v1/api${path}`, { method: 'POST', token, body });
  const read = async (path) => requireStatus(await db(path), 200, 'database verification');
  async function user(role) {
    const password = `Test-only-${randomUUID()}!`;
    const email = `wtw-${run}-${role}@example.com`;
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
    if (!created?.id) throw new Error('Local Auth did not create a user');
    users.push(created.id);
    const session = requireStatus(
      await request(config, '/auth/v1/token?grant_type=password', {
        method: 'POST',
        body: { email, password },
      }),
      200,
      'sign in local user',
    );
    if (!session?.access_token) throw new Error('Local Auth did not issue a session');
    return { id: created.id, token: session.access_token };
  }
  async function pick(host, member) {
    const id = randomUUID();
    picks.push(id);
    await insert('picks', {
      id,
      host_id: host.id,
      state: 'swiping',
      category: 'food',
      center_lat: 40,
      center_lng: -73,
      radius_m: 1000,
    });
    await insert('pick_participants', [
      { pick_id: id, user_id: host.id },
      { pick_id: id, user_id: member.id },
    ]);
    await insert(
      'pick_candidates',
      places.map((place_id) => ({
        pick_id: id,
        place_id,
        snapshot: { name: 'Integration fixture', lat: 40, lng: -73 },
      })),
    );
    return id;
  }
  try {
    await t.test('public health and rejected missing/invalid authentication', async () => {
      const health = requireStatus(
        await request(config, '/functions/v1/api/health'),
        200,
        'health',
      );
      assert.equal(health.status, 'ok');
      for (const route of ['swipes', 'rank', 'close']) {
        requireStatus(
          await api(`/picks/${randomUUID()}/${route}`, undefined, { placeId: 'none', value: 2 }),
          401,
          'missing auth',
        );
        requireStatus(
          await api(`/picks/${randomUUID()}/${route}`, 'invalid-token', {
            placeId: 'none',
            value: 2,
          }),
          401,
          'invalid auth',
        );
      }
    });
    const host = await user('host'),
      member = await user('member'),
      outsider = await user('outsider');
    places.push(`integration-${run}-a`, `integration-${run}-b`);
    await insert(
      'places',
      places.map((id) => ({
        id,
        name: 'Integration fixture',
        category: 'food',
        lat: 40,
        lng: -73,
      })),
    );
    const winnerPick = await pick(host, member),
      votePick = await pick(host, member);
    const [a, b] = places;

    await t.test('outsider and non-host requests rejected without writes', async () => {
      requireStatus(
        await api(`/picks/${winnerPick}/swipes`, outsider.token, { placeId: a, value: 2 }),
        403,
        'outsider swipe',
      );
      requireStatus(await api(`/picks/${winnerPick}/rank`, outsider.token), 403, 'outsider rank');
      requireStatus(await api(`/picks/${winnerPick}/rank`, member.token), 403, 'participant rank');
      requireStatus(await api(`/picks/${votePick}/close`, outsider.token), 403, 'outsider close');
      requireStatus(await api(`/picks/${votePick}/close`, member.token), 403, 'participant close');
      assert.equal((await read(`preferences?pick_id=eq.${winnerPick}`)).length, 0);
      const visible = requireStatus(
        await request(config, `/rest/v1/picks?id=eq.${winnerPick}&select=id`, {
          token: outsider.token,
        }),
        200,
        'outsider read',
      );
      assert.equal(visible.length, 0);
    });
    await t.test('invalid candidate rejected and missing Pick reports 404', async () => {
      requireStatus(
        await api(`/picks/${winnerPick}/swipes`, host.token, {
          placeId: 'foreign-place',
          value: 2,
        }),
        400,
        'foreign candidate',
      );
      requireStatus(await api(`/picks/${randomUUID()}/rank`, host.token), 404, 'missing Pick');
      assert.equal((await read(`preferences?pick_id=eq.${winnerPick}`)).length, 0);
    });
    await t.test(
      'authenticated swipes persist, upsert and derive identity from token',
      async () => {
        requireStatus(
          await api(`/picks/${winnerPick}/swipes`, member.token, {
            placeId: a,
            value: 0,
            userId: outsider.id,
          }),
          200,
          'first swipe',
        );
        requireStatus(
          await api(`/picks/${winnerPick}/swipes`, member.token, {
            placeId: a,
            value: 2,
            userId: outsider.id,
          }),
          200,
          'upsert swipe',
        );
        const rows = await read(
          `preferences?pick_id=eq.${winnerPick}&place_id=eq.${a}&select=user_id,value`,
        );
        assert.equal(rows.length, 1);
        assert.equal(rows[0].user_id, member.id);
        assert.equal(rows[0].value, 2);
        requireStatus(
          await api(`/picks/${winnerPick}/swipes`, host.token, { placeId: a, value: 2 }),
          200,
          'host swipe',
        );
        for (const u of [host, member])
          requireStatus(
            await api(`/picks/${winnerPick}/swipes`, u.token, { placeId: b, value: 0 }),
            200,
            'negative swipe',
          );
        const own = requireStatus(
          await request(
            config,
            `/rest/v1/preferences?pick_id=eq.${winnerPick}&select=user_id,value`,
            { token: member.token },
          ),
          200,
          'private preference read',
        );
        assert.equal(own.length, 2);
        assert.ok(own.every((row) => row.user_id === member.id));
      },
    );
    await t.test('final swipe automatically completes the Pick and persists exact ranking', async () => {
      // Verify persistence before any /close or /rank call could conceal a failed auto-close.
      assert.equal((await read(`preferences?pick_id=eq.${winnerPick}`)).length, 4);
      const [stored] = await read(
        `picks?id=eq.${winnerPick}&select=state,winner_place_id,decided_by,decided_at`,
      );
      assert.equal(stored.state, 'completed');
      assert.equal(stored.winner_place_id, a);
      assert.equal(stored.decided_by, 'clear_winner');
      assert.ok(Number.isFinite(Date.parse(stored.decided_at)));
      const rows = await read(
        `ranking_results?pick_id=eq.${winnerPick}&select=place_id,rank&order=rank`,
      );
      assert.deepEqual(rows, [
        { place_id: a, rank: 1 },
        { place_id: b, rank: 2 },
      ]);
      const result = requireStatus(
        await api(`/picks/${winnerPick}/close`, host.token),
        200,
        'read already-closed decision',
      );
      assert.deepEqual(result, { state: 'completed', winnerPlaceId: a, finalists: [] });
      assert.ok(!JSON.stringify(result).includes('score'));
    });
    await t.test('post-close rank and swipe conflict without changing outcome', async () => {
      const pickPath = `picks?id=eq.${winnerPick}&select=state,winner_place_id,decided_by,decided_at,vote_deadline_at,version`;
      const rankingPath = `ranking_results?pick_id=eq.${winnerPick}&order=rank`;
      const preferencesPath = `preferences?pick_id=eq.${winnerPick}&order=user_id,place_id`;
      const before = {
        pick: await read(pickPath),
        ranking: await read(rankingPath),
        preferences: await read(preferencesPath),
      };
      requireStatus(await api(`/picks/${winnerPick}/rank`, host.token), 409, 'rank retry');
      requireStatus(
        await api(`/picks/${winnerPick}/swipes`, member.token, { placeId: a, value: 0 }),
        409,
        'late swipe',
      );
      assert.deepEqual(await read(pickPath), before.pick);
      assert.deepEqual(await read(rankingPath), before.ranking);
      assert.deepEqual(await read(preferencesPath), before.preferences);
    });
    await t.test('canonical close persists finalists and a stable future vote deadline', async () => {
      const result = requireStatus(
        await api(`/picks/${votePick}/close`, host.token),
        200,
        'tied close',
      );
      assert.deepEqual(result, {
        state: 'final_vote',
        winnerPlaceId: null,
        finalists: [a, b],
      });
      assert.ok(!JSON.stringify(result).includes('score'));
      const pickPath = `picks?id=eq.${votePick}&select=state,winner_place_id,decided_at,vote_deadline_at,version`;
      const [stored] = await read(pickPath);
      assert.equal(stored.state, 'final_vote');
      assert.equal(stored.winner_place_id, null);
      assert.equal(stored.decided_at, null);
      assert.ok(Date.parse(stored.vote_deadline_at) > Date.now(), 'vote deadline must be in the future');
      const rankingPath = `ranking_results?pick_id=eq.${votePick}&select=place_id,rank,finalist&order=rank`;
      const rows = await read(rankingPath);
      assert.deepEqual(rows, [
        { place_id: a, rank: 1, finalist: true },
        { place_id: b, rank: 2, finalist: true },
      ]);
      const repeated = requireStatus(
        await api(`/picks/${votePick}/close`, host.token),
        200,
        'repeated close',
      );
      assert.deepEqual(repeated, result);
      // Includes the original deadline and version: a retry must not extend or rewrite either.
      assert.deepEqual(await read(pickPath), [stored]);
      assert.deepEqual(await read(rankingPath), rows);
    });
  } finally {
    // Clean only resources created by this run, including partial setup failures.
    let failed = false;
    for (const id of picks) {
      try {
        requireStatus(await db(`picks?id=eq.${id}`, { method: 'DELETE' }), 204, 'cleanup Pick');
      } catch {
        failed = true;
      }
    }
    for (const id of places) {
      try {
        requireStatus(await db(`places?id=eq.${id}`, { method: 'DELETE' }), 204, 'cleanup place');
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
});
