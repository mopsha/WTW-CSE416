import {
  cancelPick,
  createPick,
  getPick,
  parseCreatePick,
  refreshPick,
  startPick,
  type LifecycleStore,
  type LifecyclePick,
} from '@shared/api/lifecycle.ts';
import type { PoolBuilder } from '@shared/places/pool.ts';
import type { Candidate } from '@shared/places/types.ts';

const pick = (overrides: Partial<LifecyclePick> = {}): LifecyclePick => ({
  id: 'pick',
  hostId: 'host',
  state: 'draft',
  category: 'food',
  center: { lat: 0, lng: 0 },
  radiusM: 1000,
  poolSize: 20,
  deadlineAt: null,
  closeThreshold: 100,
  participantIds: ['host', 'guest'],
  candidates: [],
  hasAnswers: false,
  myAnswers: {},
  winnerPlaceId: null,
  decidedAt: null,
  decidedBy: null,
  version: '1',
  ...overrides,
});

function fixture(p: LifecyclePick | null = pick()) {
  return {
    createPick: jest.fn().mockResolvedValue({ id: 'new-pick' }),
    load: jest.fn().mockResolvedValue(p),
    start: jest.fn().mockResolvedValue(undefined),
    refresh: jest.fn().mockResolvedValue(undefined),
    cancel: jest.fn().mockResolvedValue(undefined),
  } satisfies LifecycleStore;
}

const candidate = (placeId: string): Candidate => ({
  placeId,
  name: placeId,
  category: 'food',
  lat: 0,
  lng: 0,
});

function poolOf(candidates: Candidate[]): PoolBuilder {
  return { buildPool: jest.fn().mockResolvedValue(candidates) };
}

describe('parseCreatePick', () => {
  const now = new Date('2026-10-16T00:00:00Z').getTime();
  test.each([
    null,
    [],
    {},
    { category: 'nope', center: { lat: 0, lng: 0 }, radiusM: 1000 },
    { category: 'food', center: { lat: 91, lng: 0 }, radiusM: 1000 },
    { category: 'food', center: { lat: 0, lng: 0 }, radiusM: 100 },
    { category: 'food', center: { lat: 0, lng: 0 }, radiusM: 1000, poolSize: 4 },
    { category: 'food', center: { lat: 0, lng: 0 }, radiusM: 1000, closeThreshold: 0 },
    { category: 'food', center: { lat: 0, lng: 0 }, radiusM: 1000, deadlineAt: 'not-a-date' },
    {
      category: 'food',
      center: { lat: 0, lng: 0 },
      radiusM: 1000,
      deadlineAt: new Date(now + 60_000).toISOString(),
    },
    {
      category: 'food',
      center: { lat: 0, lng: 0 },
      radiusM: 1000,
      deadlineAt: new Date(now + 8 * 24 * 60 * 60_000).toISOString(),
    },
  ])('rejects malformed input %j', (body) => {
    expect(() => parseCreatePick(body, now)).toThrow();
  });
  test('fills in defaults', () => {
    expect(
      parseCreatePick({ category: 'activities', center: { lat: 1, lng: 2 }, radiusM: 500 }, now),
    ).toEqual({
      category: 'activities',
      center: { lat: 1, lng: 2 },
      radiusM: 500,
      poolSize: 20,
      closeThreshold: 100,
      deadlineAt: null,
    });
  });
});

test('createPick passes the parsed input straight through and returns pickId', async () => {
  const store = fixture();
  const result = await createPick(store, 'host', {
    category: 'food',
    center: { lat: 1, lng: 2 },
    radiusM: 500,
  });
  expect(result).toEqual({ pickId: 'new-pick', state: 'draft' });
  expect(store.createPick).toHaveBeenCalledWith(
    'host',
    expect.objectContaining({ category: 'food', radiusM: 500 }),
  );
});

describe('startPick', () => {
  test('host starts a draft Pick with at least 2 participants', async () => {
    const store = fixture();
    const pool = poolOf([candidate('a'), candidate('b')]);
    const result = await startPick(store, pool, 'pick', 'host');
    expect(result).toEqual({ state: 'swiping', candidateCount: 2 });
    expect(store.start).toHaveBeenCalledWith(
      'pick',
      'host',
      expect.arrayContaining([{ placeId: 'a', snapshot: candidate('a') }]),
    );
  });
  test('rejects a non-host', async () => {
    const store = fixture();
    const pool = poolOf([candidate('a')]);
    await expect(startPick(store, pool, 'pick', 'guest')).rejects.toMatchObject({ status: 403 });
    expect(store.start).not.toHaveBeenCalled();
  });
  test('rejects starting twice (not draft)', async () => {
    const store = fixture(pick({ state: 'swiping' }));
    const pool = poolOf([candidate('a')]);
    await expect(startPick(store, pool, 'pick', 'host')).rejects.toMatchObject({ status: 409 });
    expect(store.start).not.toHaveBeenCalled();
  });
  test('requires at least 2 participants', async () => {
    const store = fixture(pick({ participantIds: ['host'] }));
    const pool = poolOf([candidate('a')]);
    await expect(startPick(store, pool, 'pick', 'host')).rejects.toMatchObject({ status: 409 });
    expect(store.start).not.toHaveBeenCalled();
  });
  test('rejects an empty pool', async () => {
    const store = fixture();
    const pool = poolOf([]);
    await expect(startPick(store, pool, 'pick', 'host')).rejects.toMatchObject({ status: 409 });
    expect(store.start).not.toHaveBeenCalled();
  });
});

describe('refreshPick', () => {
  test('refreshes freely before anyone has swiped', async () => {
    const store = fixture(pick({ state: 'swiping', hasAnswers: false }));
    const pool = poolOf([candidate('a')]);
    await refreshPick(store, pool, 'pick', 'host', {});
    expect(store.refresh).toHaveBeenCalled();
  });
  test('requires confirm once swiping has started', async () => {
    const store = fixture(pick({ state: 'swiping', hasAnswers: true }));
    const pool = poolOf([candidate('a')]);
    await expect(refreshPick(store, pool, 'pick', 'host', {})).rejects.toMatchObject({
      status: 409,
      code: 'CONFIRM_REQUIRED',
    });
    expect(store.refresh).not.toHaveBeenCalled();
  });
  test('confirm:true clears answers by replacing the pool', async () => {
    const store = fixture(pick({ state: 'swiping', hasAnswers: true }));
    const pool = poolOf([candidate('a')]);
    await refreshPick(store, pool, 'pick', 'host', { confirm: true });
    expect(store.refresh).toHaveBeenCalled();
  });
  test('rejects a non-host', async () => {
    const store = fixture(pick({ state: 'swiping' }));
    const pool = poolOf([candidate('a')]);
    await expect(refreshPick(store, pool, 'pick', 'guest', {})).rejects.toMatchObject({
      status: 403,
    });
    expect(store.refresh).not.toHaveBeenCalled();
  });
  test('rejects refreshing a decided Pick', async () => {
    const store = fixture(pick({ state: 'completed' }));
    const pool = poolOf([candidate('a')]);
    await expect(refreshPick(store, pool, 'pick', 'host', {})).rejects.toMatchObject({
      status: 409,
    });
  });
});

describe('cancelPick', () => {
  test('host cancels an unfinished Pick', async () => {
    const store = fixture(pick({ state: 'swiping' }));
    expect(await cancelPick(store, 'pick', 'host')).toEqual({ state: 'canceled' });
    expect(store.cancel).toHaveBeenCalledWith('pick', 'host', null);
  });
  test('stores a trimmed reason and tells everyone else, reason in the inbox only', async () => {
    const notifier = jest.fn().mockResolvedValue(undefined);
    const store = { ...fixture(pick({ state: 'swiping' })), notifier };
    await cancelPick(store, 'pick', 'host', { reason: '  Rained out  ' });
    expect(store.cancel).toHaveBeenCalledWith('pick', 'host', 'Rained out');
    expect(notifier).toHaveBeenCalledWith(['guest'], 'pick_canceled', 'pick', {
      reason: 'Rained out',
    });
  });
  test.each([
    [{ reason: 5 }],
    [{ reason: 'x'.repeat(201) }],
    [[]],
    ['text'],
    [{ reason: 'a\u0000b' }],
    [{ reason: '\n'.repeat(200) }],
    [{ reason: 'you fucking idiots' }],
  ])('rejects a bad reason %j before touching the Pick', async (body) => {
    const store = fixture(pick({ state: 'swiping' }));
    await expect(cancelPick(store, 'pick', 'host', body)).rejects.toMatchObject({ status: 400 });
    expect(store.load).not.toHaveBeenCalled();
  });
  test('rejects a non-host', async () => {
    const store = fixture(pick({ state: 'swiping' }));
    await expect(cancelPick(store, 'pick', 'guest')).rejects.toMatchObject({ status: 403 });
    expect(store.cancel).not.toHaveBeenCalled();
  });
  test('rejects canceling an already-decided Pick', async () => {
    const store = fixture(pick({ state: 'completed' }));
    await expect(cancelPick(store, 'pick', 'host')).rejects.toMatchObject({ status: 409 });
    expect(store.cancel).not.toHaveBeenCalled();
  });
});

describe('getPick', () => {
  test("returns candidates in this caller's shuffled order and the caller's own answers", async () => {
    const candidates = [candidate('a'), candidate('b'), candidate('c')].map((c) => ({
      placeId: c.placeId,
      snapshot: c,
    }));
    const store = fixture(pick({ state: 'swiping', candidates, myAnswers: { a: 2 } }));
    const result = await getPick(store, 'pick', 'host');
    const placeIds = result.candidates.map((c) => (c as Candidate | undefined)?.placeId);
    expect(placeIds.sort()).toEqual(['a', 'b', 'c']);
    expect(result.myAnswers).toEqual({ a: 2 });
    expect(result.isHost).toBe(true);
  });
  test('rejects a non-participant', async () => {
    const store = fixture();
    await expect(getPick(store, 'pick', 'outsider')).rejects.toMatchObject({ status: 403 });
  });
  test('rejects a missing Pick', async () => {
    const store = fixture(null);
    await expect(getPick(store, 'pick', 'host')).rejects.toMatchObject({ status: 404 });
  });
});

describe('read-time candidate hours', () => {
  test.each(['completed', 'final_vote'] as const)(
    'enriches %s only after membership validation without writes',
    async (state) => {
      const p = pick({ state, candidates: [{ placeId: 'a', snapshot: candidate('a') }] });
      const store = fixture(p);
      const refresh = jest
        .fn()
        .mockResolvedValue([{ placeId: 'a', openNow: true, closesAt: null }]);
      await expect(getPick(store, 'pick', 'outsider', refresh)).rejects.toMatchObject({
        status: 403,
      });
      expect(refresh).not.toHaveBeenCalled();
      const before = structuredClone(p);
      const result = await getPick(store, 'pick', 'guest', refresh);
      expect(refresh).toHaveBeenCalledWith(p.candidates);
      expect(result.candidateHours).toEqual([{ placeId: 'a', openNow: true, closesAt: null }]);
      expect(p).toEqual(before);
      expect(store.start).not.toHaveBeenCalled();
      expect(store.refresh).not.toHaveBeenCalled();
      expect(store.cancel).not.toHaveBeenCalled();
    },
  );
  test('does not fetch while swiping and preserves completed data if enrichment fails', async () => {
    const refresh = jest.fn().mockRejectedValue(new Error('unavailable'));
    await getPick(fixture(pick({ state: 'swiping' })), 'pick', 'guest', refresh);
    expect(refresh).not.toHaveBeenCalled();
    const store = fixture(pick({ state: 'completed', winnerPlaceId: 'a' }));
    expect(await getPick(store, 'pick', 'guest', refresh)).toMatchObject({
      state: 'completed',
      winnerPlaceId: 'a',
      candidateHours: [],
    });
  });
});

test('filtered lifecycle forwards constraints and rejects Google snapshots before any write', async () => {
  const store = fixture(pick({ priceMax: 2, openNow: true }));
  const pool = poolOf([{ ...candidate('google'), provider: 'google', retention: 'request' }]);
  await expect(startPick(store, pool, 'pick', 'host')).rejects.toThrow('cannot be persisted');
  expect(pool.buildPool).toHaveBeenCalledWith(
    expect.objectContaining({ priceMax: 2, openNow: true }),
  );
  expect(store.start).not.toHaveBeenCalled();
  expect(store.refresh).not.toHaveBeenCalled();
});

test('empty filtered refresh preserves existing answers and candidates', async () => {
  const store = fixture(pick({ state: 'swiping', hasAnswers: true }));
  await expect(
    refreshPick(store, poolOf([]), 'pick', 'host', { confirm: true }),
  ).rejects.toMatchObject({ status: 409, code: 'NO_CANDIDATES' });
  expect(store.refresh).not.toHaveBeenCalled();
});

test('includeSaved loads the host only, filters radius, precedes external candidates and deduplicates', async () => {
  const store = {
    ...fixture(pick({ includeSaved: true, poolSize: 5 })),
    savedCandidates: jest.fn(async () => [
      { ...candidate('saved'), name: 'Saved metadata' },
      candidate('saved'),
      { ...candidate('outside'), lat: 10 },
    ]),
  };
  const pool = poolOf([candidate('saved'), candidate('cache'), candidate('google-fixture')]);
  await startPick(store, pool, 'pick', 'host');
  expect(store.savedCandidates).toHaveBeenCalledWith('host');
  const snapshots = store.start.mock.calls[0]![2];
  expect(snapshots.map((p: { placeId: string }) => p.placeId)).toEqual([
    'saved',
    'cache',
    'google-fixture',
  ]);
  expect(snapshots[0]!.snapshot).toMatchObject({ name: 'Saved metadata' });
});
test('without includeSaved, existing pool behavior and no saved lookup are retained', async () => {
  const savedCandidates = jest.fn();
  await startPick({ ...fixture(), savedCandidates }, poolOf([candidate('a')]), 'pick', 'host');
  expect(savedCandidates).not.toHaveBeenCalled();
});
test('pure custom start avoids external providers; mixed options keep custom before provider results', async () => {
  const custom = {
    ...candidate('custom:00000000-0000-4000-8000-000000000001'),
    category: 'custom' as const,
    provider: 'custom' as const,
    createdBy: 'host',
    locationProvided: false,
  };
  const second = { ...custom, placeId: 'custom:00000000-0000-4000-8000-000000000002' };
  const store = fixture(pick({ category: 'custom', customOptions: [custom, second], poolSize: 4 }));
  const pool = poolOf([candidate('nearby')]);
  await startPick(store, pool, 'pick', 'host');
  expect(pool.buildPool).not.toHaveBeenCalled();
  const mixed = fixture(
    pick({
      category: 'custom',
      customOptions: [custom, second],
      mixCategory: 'activities',
      poolSize: 4,
    }),
  );
  await startPick(mixed, pool, 'pick', 'host');
  expect(mixed.start.mock.calls[0]![2].map((p: { placeId: string }) => p.placeId)).toEqual([
    custom.placeId,
    second.placeId,
    'nearby',
  ]);
});
