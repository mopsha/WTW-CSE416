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
  test.each([
    null,
    [],
    {},
    { category: 'nope', center_lat: 0, center_lng: 0, radius_m: 100 },
    { category: 'food', center_lat: 91, center_lng: 0, radius_m: 100 },
    { category: 'food', center_lat: 0, center_lng: 0, radius_m: 0 },
    { category: 'food', center_lat: 0, center_lng: 0, radius_m: 100, pool_size: 9 },
    { category: 'food', center_lat: 0, center_lng: 0, radius_m: 100, close_threshold: 0 },
    { category: 'food', center_lat: 0, center_lng: 0, radius_m: 100, deadline_at: 'not-a-date' },
  ])('rejects malformed input %j', (body) => {
    expect(() => parseCreatePick(body)).toThrow();
  });
  test('fills in defaults', () => {
    expect(
      parseCreatePick({ category: 'activities', center_lat: 1, center_lng: 2, radius_m: 500 }),
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

test('createPick passes the parsed input straight through', async () => {
  const store = fixture();
  const result = await createPick(store, 'host', {
    category: 'food',
    center_lat: 1,
    center_lng: 2,
    radius_m: 500,
  });
  expect(result).toEqual({ id: 'new-pick', state: 'draft' });
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
    expect(store.cancel).toHaveBeenCalledWith('pick', 'host');
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
