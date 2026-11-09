import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { localConfig, request, requireStatus } from './local.mjs';
// Shared with queries.ts: same RPC and composite FK projection, not a copied/mock join.
const query = JSON.parse(
  readFileSync(
    new URL('../../supabase/functions/_shared/queries/pickSummaries.json', import.meta.url),
  ),
);
test(
  'real summary RPC, composite winner embedding, pagination and participant RLS',
  { timeout: 120_000 },
  async (t) => {
    const config = localConfig();
    const users = [],
      picks = [],
      places = [];
    const db = (path, options = {}) =>
      request(config, '/rest/v1/' + path, {
        ...options,
        key: config.service,
        token: config.service,
      });
    const insert = async (table, body) =>
      requireStatus(await db(table, { method: 'POST', body }), 201, table);
    async function user() {
      const email = `history-${randomUUID()}@example.com`,
        password = `Test-${randomUUID()}!`;
      const created = requireStatus(
        await request(config, '/auth/v1/admin/users', {
          key: config.service,
          token: config.service,
          method: 'POST',
          body: { email, password, email_confirm: true },
        }),
        200,
        'create user',
      );
      users.push(created.id);
      const session = requireStatus(
        await request(config, '/auth/v1/token?grant_type=password', {
          method: 'POST',
          body: { email, password },
        }),
        200,
        'sign in',
      );
      return { id: created.id, token: session.access_token };
    }
    const requireSummary = (response, status, label) =>
      requireStatus(
        response,
        status,
        label + (response.elapsedMs === undefined ? '' : ` (elapsedMs=${response.elapsedMs})`),
        { database: true },
      );
    const timings = [];
    const summaries = async (who, body = {}) => {
      const started = performance.now();
      const response = await request(
        config,
        `/rest/v1/rpc/${query.rpc}?select=${encodeURIComponent(query.select)}`,
        {
          method: 'POST',
          token: who?.token,
          body: { p_history: true, p_limit: 5, ...body },
        },
      );
      const elapsedMs = Math.round(performance.now() - started);
      timings.push(elapsedMs);
      return { ...response, elapsedMs };
    };
    try {
      const member = await user(),
        outsider = await user();
      const old = Array.from({ length: 1001 }, () => ({
        id: randomUUID(),
        host_id: member.id,
        category: 'food',
        state: 'canceled',
        center_lat: 40,
        center_lng: -73,
        radius_m: 1000,
        created_at: '2020-01-01T00:00:00Z',
      }));
      // Insert old memberships last: join-row recency must not control history order.
      for (let n = 0; n < old.length; n += 200) {
        const batch = old.slice(n, n + 200);
        picks.push(...batch.map((p) => p.id));
        await insert('picks', batch);
      }
      const expected = [];
      for (const [n, category] of ['food', 'custom', 'activities', 'both', 'food'].entries()) {
        const id = randomUUID(),
          first = `history-${randomUUID()}`,
          winner = `history-${randomUUID()}`;
        picks.push(id);
        places.push(first, winner);
        await insert('picks', {
          id,
          host_id: member.id,
          category,
          state: 'swiping',
          center_lat: 40,
          center_lng: -73,
          radius_m: 1000,
          created_at: '2019-01-01T00:00:00Z',
        });
        await insert('pick_participants', { pick_id: id, user_id: member.id });
        await insert(
          'places',
          [first, winner].map((placeId) => ({
            id: placeId,
            name: placeId,
            category: category === 'activities' ? 'activities' : 'food',
            lat: 40,
            lng: -73,
          })),
        );
        const name = `Actual ${category} winner ${n}`;
        await insert('pick_candidates', [
          {
            pick_id: id,
            place_id: first,
            snapshot: { name: 'First candidate is NOT winner', lat: 40, lng: -73 },
          },
          {
            pick_id: id,
            place_id: winner,
            snapshot: {
              name,
              lat: 40,
              lng: -73,
              ...(category === 'custom' ? { provider: 'custom' } : {}),
            },
          },
        ]);
        // Both tie-break and clear-winner results are persisted through the same winner FK.
        const decidedAt = n < 2 ? '2026-10-10T12:00:00Z' : `2026-10-0${9 - n}T12:00:00Z`;
        requireStatus(
          await db(`picks?id=eq.${id}`, {
            method: 'PATCH',
            body: {
              state: 'completed',
              winner_place_id: winner,
              decided_at: decidedAt,
              decided_by: n === 2 ? 'tie_break' : 'clear_winner',
            },
          }),
          204,
          'persist winner',
        );
        expected.push({ id, name, time: decidedAt });
      }
      for (let n = 0; n < old.length; n += 200)
        await insert(
          'pick_participants',
          old.slice(n, n + 200).map((p) => ({ pick_id: p.id, user_id: member.id })),
        );
      expected.sort((a, b) => b.time.localeCompare(a.time) || a.id.localeCompare(b.id));
      const winnerResponse = await summaries(member);
      const top = requireSummary(winnerResponse, 200, 'real RPC winner projection');
      assert.ok(
        winnerResponse.elapsedMs < 4000,
        `Summary RPC must retain headroom under the unchanged 8s database timeout; elapsedMs=${winnerResponse.elapsedMs}`,
      );
      assert.deepEqual(
        top.map((p) => [p.id, p.winner?.name]),
        expected.map((p) => [p.id, p.name]),
      );
      const page1 = requireSummary(await summaries(member, { p_limit: 1 }), 200, 'first tie page');
      const page2 = requireSummary(
        await summaries(member, {
          p_limit: 1,
          p_before_time: page1[0].decided_at,
          p_before_id: page1[0].id,
        }),
        200,
        'second tie page',
      );
      assert.equal(page2[0].id, expected[1].id);
      const canceled = requireSummary(
        await summaries(member, {
          p_before_time: top[4].decided_at,
          p_before_id: top[4].id,
        }),
        200,
        'canceled page',
      );
      assert.equal(canceled.length, 5);
      assert.ok(canceled.every((p) => p.state === 'canceled' && p.winner === null));
      assert.deepEqual(requireSummary(await summaries(outsider), 200, 'outsider'), []);
      const exhausted = requireSummary(
        await summaries(member, {
          p_before_time: '1900-01-01T00:00:00Z',
          p_before_id: top[0].id,
        }),
        200,
        'exhausted page',
      );
      assert.deepEqual(exhausted, []);
      requireSummary(await summaries(member, { p_limit: 101 }), 400, 'invalid page limit');
      const anon = await summaries(null);
      assert.ok([401, 403].includes(anon.status));
      // Access is re-evaluated on every page.
      requireStatus(
        await db(`pick_participants?pick_id=eq.${top[0].id}&user_id=eq.${member.id}`, {
          method: 'DELETE',
        }),
        204,
        'remove participation',
      );
      const revoked = requireSummary(await summaries(member), 200, 'revoked read');
      assert.ok(revoked.every((p) => p.id !== top[0].id));
      t.diagnostic('Summary RPC timings (ms): ' + timings.join(', '));
    } finally {
      for (let n = 0; n < picks.length; n += 100)
        requireStatus(
          await db(`picks?id=in.(${picks.slice(n, n + 100).join(',')})`, { method: 'DELETE' }),
          204,
          'cleanup picks',
        );
      for (const place of places)
        requireStatus(
          await db(`places?id=eq.${place}`, { method: 'DELETE' }),
          204,
          'cleanup place',
        );
      for (const id of users)
        requireStatus(
          await request(config, `/auth/v1/admin/users/${id}`, {
            method: 'DELETE',
            key: config.service,
            token: config.service,
          }),
          200,
          'cleanup user',
        );
    }
  },
);
