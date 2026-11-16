import { createApp } from './app.ts';
import type { LifecyclePick } from '../_shared/api/lifecycle.ts';
import type { Availability } from '../_shared/domain/availability.ts';
import { ApiError } from '../_shared/api/errors.ts';
function equal(a: unknown, b: unknown) {
  if (JSON.stringify(a) !== JSON.stringify(b))
    throw new Error(`Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
const unexpected = async (): Promise<never> => {
  throw new Error('Unexpected mutation');
};
function fixture(enabled = true) {
  const a: Availability = {
    proposedAt: new Date(Date.now() + 2 * 86400000).toISOString(),
    revision: 1,
    locked: false,
    canVote: false,
    cohortUserIds: [],
    deadlineMinutes: 60,
    participants: [
      { userId: 'actor', displayName: 'Host', response: 'yes' },
      { userId: 'friend', displayName: 'Friend', response: 'maybe' },
    ],
  };
  const pick: LifecyclePick = {
    id: 'pick',
    hostId: 'actor',
    state: 'draft',
    category: 'food',
    center: { lat: 40, lng: -73 },
    radiusM: 3000,
    poolSize: 20,
    closeThreshold: 100,
    deadlineAt: null,
    participantIds: ['actor', 'friend'],
    availability: a,
    candidates: [],
    hasAnswers: false,
    myAnswers: {},
    winnerPlaceId: null,
    decidedAt: null,
    decidedBy: null,
    version: '1',
  };
  const calls: unknown[] = [];
  let builds = 0;
  let reserved = false;
  const app = createApp({
    availabilityEnabled: enabled,
    getUser: async (req) => {
      if (req.headers.get('Authorization') !== 'Bearer actor')
        throw new ApiError(401, 'UNAUTHORIZED', 'Sign in');
      return { id: 'actor' };
    },
    store: { loadPick: async () => null, upsertSwipe: unexpected, saveRanking: unexpected },
    lifecycleStore: {
      load: async () => pick,
      createPick: async (u, input) => {
        calls.push(['create', u, input]);
        return { id: 'created' };
      },
      start: unexpected,
      refresh: unexpected,
      cancel: unexpected,
      availability: {
        load: async () => a,
        respond: async (...args) => {
          calls.push(['respond', ...args]);
        },
        changeTime: async (...args) => {
          calls.push(['time', ...args]);
        },
        claim: async () => {
          if (a.locked) return { started: true, candidateCount: 1 };
          if (reserved) throw new ApiError(409, 'BUSY', 'Starting');
          reserved = true;
          return { started: false, token: 'token' };
        },
        finish: async () => {
          a.locked = true;
          a.canVote = true;
          a.cohortUserIds = ['actor', 'friend'];
          pick.state = 'swiping';
        },
        abort: async () => {
          reserved = false;
        },
      },
    },
    poolBuilder: {
      buildPool: async () => {
        builds++;
        return [{ placeId: 'cafe', name: 'Cafe', category: 'food', lat: 40, lng: -73 }];
      },
    },
    closingStore: {
      loadForClose: async () => null,
      applyClose: unexpected,
      loadForVote: async () => null,
      castVote: unexpected,
      applyVoteClose: unexpected,
    },
  });
  const request = (path: string, body?: unknown, modern = true, auth = true) =>
    app.request(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(auth ? { Authorization: 'Bearer actor' } : {}),
        ...(modern ? { 'X-Client-Info': 'availability-v1' } : {}),
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { app, request, calls, a, builds: () => builds };
}
Deno.test('availability capabilities authenticate and expose staged rollout flag', async () => {
  const f = fixture();
  equal((await f.request('/picks/capabilities', undefined, true, false)).status, 401);
  equal(await (await f.request('/picks/capabilities')).json(), { availabilityFirst: true });
  equal(await (await fixture(false).request('/picks/capabilities')).json(), {
    availabilityFirst: false,
  });
});
Deno.test(
  'scheduled creation requires feature enablement and modern client; old payloads still create',
  async () => {
    const input = {
      category: 'food',
      center: { lat: 40, lng: -73 },
      radiusM: 3000,
      poolSize: 20,
      closeThreshold: 100,
      deadlineAt: null,
    };
    for (const enabled of [false, true]) {
      const f = fixture(enabled);
      const timed = { ...input, proposedAt: f.a.proposedAt, swipeDeadlineMinutes: 60 };
      equal((await f.request('/picks', timed, false)).status, 409);
      equal(f.calls.length, 0);
      equal((await f.request('/picks', timed)).status, enabled ? 201 : 409);
      equal((await f.request('/picks', input, false)).status, 201);
    }
  },
);
Deno.test(
  'availability routes authenticate, validate revision and prevent acting for another user',
  async () => {
    const f = fixture();
    equal(
      (await f.request('/picks/pick/availability', { revision: 1, response: 'yes' }, true, false))
        .status,
      401,
    );
    equal(
      (
        await f.request('/picks/pick/availability', {
          revision: 1,
          response: 'yes',
          userId: 'victim',
        })
      ).status,
      400,
    );
    equal(
      (await f.request('/picks/pick/availability', { revision: 0, response: 'yes' })).status,
      400,
    );
    equal(f.calls.length, 0);
    for (const response of ['yes', 'maybe', 'cant'])
      equal((await f.request('/picks/pick/availability', { revision: 1, response })).status, 200);
    equal(f.calls, [
      ['respond', 'pick', 'actor', 1, 'yes'],
      ['respond', 'pick', 'actor', 1, 'maybe'],
      ['respond', 'pick', 'actor', 1, 'cant'],
    ]);
  },
);
Deno.test('time edits are canonical, revision-scoped, and not attendance writes', async () => {
  const f = fixture();
  equal(
    (await f.request('/picks/pick/proposed-time', { revision: 1, proposedAt: 'bad' })).status,
    400,
  );
  equal(
    (await f.request('/picks/pick/proposed-time', { revision: 1, proposedAt: f.a.proposedAt }))
      .status,
    200,
  );
  equal(f.calls, [['time', 'pick', 'actor', 1, f.a.proposedAt]]);
});
Deno.test(
  'legacy scheduled read/start fails closed; modern concurrent start builds once and retry is idempotent',
  async () => {
    const f = fixture();
    equal((await f.request('/picks/pick', undefined, false)).status, 409);
    equal((await f.request('/picks/pick/start', {}, false)).status, 409);
    equal(f.builds(), 0);
    const results = await Promise.all([
      f.request('/picks/pick/start', {}),
      f.request('/picks/pick/start', {}),
    ]);
    equal(results.map((r) => r.status).sort(), [200, 409]);
    equal(f.builds(), 1);
    equal((await f.request('/picks/pick/start', {})).status, 200);
    equal(f.builds(), 1);
  },
);
