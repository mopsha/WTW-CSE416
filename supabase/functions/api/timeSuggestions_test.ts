import { createApp } from './app.ts';
import { ApiError } from '../_shared/api/errors.ts';
function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
const unexpected = async (): Promise<never> => {
  throw new Error('Unexpected operation');
};
const suggestion = 'a3000000-0000-4000-8000-000000000001';
function fixture(enabled = true) {
  const calls: unknown[] = [];
  const app = createApp({
    getUser: async (req) => {
      if (req.headers.get('Authorization') !== 'Bearer actor')
        throw new ApiError(401, 'UNAUTHORIZED', 'Sign in');
      return { id: 'actor' };
    },
    store: { loadPick: async () => null, upsertSwipe: unexpected, saveRanking: unexpected },
    lifecycleStore: {
      load: async () => null,
      createPick: unexpected,
      start: unexpected,
      refresh: unexpected,
      cancel: unexpected,
    },
    poolBuilder: { buildPool: unexpected },
    closingStore: {
      loadForClose: async () => null,
      applyClose: unexpected,
      loadForVote: async () => null,
      castVote: unexpected,
      applyVoteClose: unexpected,
    },
    timeSuggestionsEnabled: enabled,
    timeSuggestionsStore: {
      load: async (...args) => {
        calls.push(['load', ...args]);
        return {
          revision: 1,
          planAt: new Date(Date.now() + 86400000).toISOString(),
          isHost: false,
          suggestions: [],
        };
      },
      suggest: async (...args) => {
        calls.push(['suggest', ...args]);
        return { id: suggestion, notifyUserIds: ['host'] };
      },
      act: async (...args) => {
        calls.push(['act', ...args]);
        if (args[1] !== 'host') throw new ApiError(403, 'FORBIDDEN', 'Host only');
        return { id: suggestion };
      },
    },
  });
  const request = (path: string, body?: unknown, auth = true) =>
    app.request(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(auth ? { Authorization: 'Bearer actor' } : {}),
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { request, calls };
}
Deno.test(
  'time suggestion routes authenticate before reads, expose capability only when enabled, and fail closed',
  async () => {
    const f = fixture();
    equal((await f.request('/picks/p/time-suggestions', undefined, false)).status, 401);
    equal(f.calls, []);
    equal((await f.request('/picks/p/time-suggestions')).status, 200);
    equal(f.calls, [['load', 'p', 'actor']]);
    equal((await (await f.request('/picks/capabilities')).json()).timeSuggestions, true);
    const off = fixture(false);
    equal((await off.request('/picks/p/time-suggestions')).status, 409);
    equal(off.calls, []);
  },
);
Deno.test(
  'suggestion API derives actor, validates revision/timezone and rejects actor spoofing',
  async () => {
    const f = fixture();
    const planAt = new Date(Date.now() + 2 * 86400000).toISOString();
    equal(
      (await f.request('/picks/p/time-suggestions', { planAt, revision: 1, userId: 'other' }))
        .status,
      400,
    );
    equal(
      (await f.request('/picks/p/time-suggestions', { planAt: '2026-12-01', revision: 1 })).status,
      400,
    );
    equal((await f.request('/picks/p/time-suggestions', { planAt, revision: -1 })).status, 400);
    equal(f.calls, []);
    equal((await f.request('/picks/p/time-suggestions', { planAt, revision: 1 })).status, 200);
    equal(f.calls, [['suggest', 'p', 'actor', 1, planAt]]);
  },
);
Deno.test('acceptance forwards actor/revision to server authorization without bypass', async () => {
  const f = fixture();
  equal(
    (await f.request(`/picks/p/time-suggestions/${suggestion}/accept`, { revision: 1 })).status,
    403,
  );
  equal(f.calls, [['act', 'p', 'actor', suggestion, 1, 'accept']]);
  equal(
    (
      await f.request(`/picks/p/time-suggestions/${suggestion}/accept`, {
        revision: 1,
        userId: 'host',
      })
    ).status,
    400,
  );
});
