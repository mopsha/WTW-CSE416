import {
  groupIdeaCandidates,
  groupIdeaCategory,
  mixGroupIdeaCandidates,
} from '@shared/domain/groupIdeaCandidates.ts';
import {
  parseCreatePick,
  startPick,
  refreshPick,
  type LifecyclePick,
  type LifecycleStore,
} from '@shared/api/lifecycle.ts';
import { validateCreatePick } from '@shared/domain/createPick.ts';
import { NoCandidatesError, type PoolBuilder } from '@shared/places/pool.ts';
import type { GroupIdea } from '@shared/api/groupIdeas.ts';
import { candidateFromApi, milesFromCampus } from '@/lib/places';

const groupId = '22222222-2222-4222-8222-222222222222';
const idea: GroupIdea = {
  id: '33333333-3333-4333-8333-333333333333',
  groupId,
  createdBy: 'creator',
  name: 'Catan',
  category: 'activity',
  description: 'Bring snacks',
  locationText: 'John’s house',
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
};
const food = { ...idea, id: 'food-idea', category: 'food' as const, name: 'Cook dinner' };
const center = { lat: 40.9126, lng: -73.1234 };
const input = {
  category: 'activities' as const,
  center,
  radiusM: 5000,
  poolSize: 5,
  deadlineAt: null,
  closeThreshold: 100,
};
const publicPlace = {
  placeId: 'public',
  name: 'Bowling',
  category: 'activities' as const,
  ...center,
};
const candidates = (category: 'food' | 'activities' | undefined) =>
  groupIdeaCandidates(
    [idea, food, { ...idea, id: 'foreign', groupId: 'other' }],
    groupId,
    category,
    center,
    () => '44444444-4444-4444-8444-444444444444',
  );

test('food/activity/both filtering and group isolation are explicit', () => {
  expect(candidates('food').map((i) => i.name)).toEqual(['Cook dinner']);
  expect(candidates('activities').map((i) => i.name)).toEqual(['Catan']);
  expect(candidates(undefined).map((i) => i.name)).toEqual(['Catan', 'Cook dinner']);
  expect(groupIdeaCategory('custom')).toBeUndefined();
  expect(groupIdeaCategory('custom', 'food')).toBe('food');
});
test('snapshot provenance is explicit, detached from library edits and safe without coordinates', () => {
  const snapshot = candidates('activities')[0]!;
  expect(snapshot).toMatchObject({
    provider: 'custom',
    origin: 'group_idea',
    groupIdeaId: idea.id,
    groupId,
    locationProvided: false,
    note: 'Bring snacks',
    address: 'John’s house',
  });
  const visible = candidateFromApi(snapshot);
  expect(visible).toMatchObject({
    lat: null,
    lng: null,
    origin: 'group_idea',
    groupIdeaId: idea.id,
  });
  expect(milesFromCampus(visible)).toBeNull();
  const edited = { ...idea, name: 'Changed', description: 'Changed' };
  expect(edited.name).not.toBe(snapshot.name);
  expect(snapshot.name).toBe('Catan');
});
test('bounded mixing preserves typed options, alternates providers and deduplicates by ID', () => {
  const typed = { placeId: 'typed' },
    a = { placeId: 'idea-a' },
    b = { placeId: 'idea-b' },
    p = { placeId: 'public' };
  expect(mixGroupIdeaCandidates([typed, p], [a, b], 4, 1)).toEqual([typed, a, p, b]);
  expect(mixGroupIdeaCandidates([p, p], [a, a], 30).map((c) => c.placeId)).toEqual([
    'idea-a',
    'public',
  ]);
  expect(mixGroupIdeaCandidates([typed, p], [a, b], 2, 1)).toEqual([typed, a]);
});
test('opt-in validates boolean and group, default remains absent', () => {
  expect(parseCreatePick(input)).not.toHaveProperty('includeGroupIdeas');
  expect(parseCreatePick({ ...input, groupId, includeGroupIdeas: true })).toMatchObject({
    groupId,
    includeGroupIdeas: true,
  });
  expect(() => parseCreatePick({ ...input, includeGroupIdeas: true })).toThrow();
  expect(() => parseCreatePick({ ...input, includeGroupIdeas: 'yes' })).toThrow();
  expect(validateCreatePick({ ...input, includeGroupIdeas: true })).toEqual(
    expect.arrayContaining([expect.objectContaining({ field: 'includeGroupIdeas' })]),
  );
});
function setup(enabled?: boolean) {
  let nextId = 0;
  const pick = {
    ...input,
    includeGroupIdeas: enabled,
    groupId,
    id: 'pick',
    hostId: 'host',
    state: 'draft',
    participantIds: ['host', 'guest'],
    candidates: [],
    hasAnswers: false,
    myAnswers: {},
    winnerPlaceId: null,
    decidedAt: null,
    decidedBy: null,
    version: '1',
  } as LifecyclePick;
  const store = {
    load: jest.fn(async () => pick),
    groupIdeas: jest.fn(async () => [idea, food]),
    candidateUuid: jest.fn(
      () => `44444444-4444-4444-8444-${(++nextId).toString().padStart(12, '0')}`,
    ),
    start: jest
      .fn<Promise<void>, Parameters<LifecycleStore['start']>>()
      .mockResolvedValue(undefined),
    refresh: jest
      .fn<Promise<void>, Parameters<LifecycleStore['refresh']>>()
      .mockResolvedValue(undefined),
    createPick: jest.fn(),
    cancel: jest.fn(),
  } satisfies LifecycleStore;
  const pool = {
    buildPool: jest
      .fn<ReturnType<PoolBuilder['buildPool']>, Parameters<PoolBuilder['buildPool']>>()
      .mockResolvedValue([publicPlace]),
  };
  return { pick, store, pool };
}
test.each([undefined, false])(
  'OFF (%p) does not retrieve/inject ideas and keeps the exact public query',
  async (flag) => {
    const { store, pool } = setup(flag);
    await startPick(store, pool, 'pick', 'host');
    expect(store.groupIdeas).not.toHaveBeenCalled();
    expect(store.candidateUuid).not.toHaveBeenCalled();
    expect(store.start.mock.calls[0]![2]).toEqual([{ placeId: 'public', snapshot: publicPlace }]);
    expect(pool.buildPool).toHaveBeenCalledWith({
      center,
      radiusM: 5000,
      category: 'activities',
      poolSize: 5,
      priceMax: undefined,
      openNow: undefined,
    });
  },
);
test('ON mixes matching ideas, ignores provider filters for ideas, and refresh rebuilds snapshots', async () => {
  const { pick, store, pool } = setup(true);
  pick.priceMax = 0;
  pick.openNow = true;
  await startPick(store, pool, 'pick', 'host');
  expect(store.groupIdeas).toHaveBeenCalledWith(groupId, 'host');
  const snapshots = store.start.mock.calls[0]![2];
  expect(snapshots.map((c: { snapshot: object }) => (c.snapshot as { name: string }).name)).toEqual(
    ['Catan', 'Bowling'],
  );
  expect(pool.buildPool).toHaveBeenCalledWith(
    expect.objectContaining({ priceMax: 0, openNow: true }),
  );
  store.groupIdeas.mockResolvedValue([{ ...idea, name: 'Updated' }]);
  await refreshPick(store, pool, 'pick', 'host', {});
  expect((store.refresh.mock.calls[0]![2][0]!.snapshot as { name: string }).name).toBe('Updated');
  expect((snapshots[0]!.snapshot as { name: string }).name).toBe('Catan');
});
test('provider empty can still yield ideas; membership failures fail closed before provider/commit', async () => {
  const { store, pool } = setup(true);
  pool.buildPool.mockRejectedValue(new NoCandidatesError());
  await expect(startPick(store, pool, 'pick', 'host')).resolves.toMatchObject({
    candidateCount: 1,
  });
  store.groupIdeas.mockRejectedValue(new Error('Membership removed'));
  pool.buildPool.mockClear();
  store.start.mockClear();
  await expect(startPick(store, pool, 'pick', 'host')).rejects.toThrow('Membership removed');
  expect(pool.buildPool).not.toHaveBeenCalled();
  expect(store.start).not.toHaveBeenCalled();
});

test('Both uses existing separate provider queries, interleaves and includes both idea types', async () => {
  const { pick, store, pool } = setup(true);
  pick.category = 'both';
  pick.poolSize = 10;
  const result = await startPick(store, pool, 'pick', 'host');
  expect(result.candidateCount).toBe(3); // mock provider returns same ID twice, deduplicated
  expect(pool.buildPool.mock.calls.map(([query]) => query.category)).toEqual([
    'food',
    'activities',
  ]);
  expect(store.start.mock.calls[0]![2].map((s) => (s.snapshot as { name: string }).name)).toEqual(
    expect.arrayContaining(['Catan', 'Cook dinner', 'Bowling']),
  );
  expect(parseCreatePick({ ...input, category: 'both' }).category).toBe('both');
});

test('opt-in custom Picks must leave capacity beyond typed options', () => {
  const body = {
    ...input,
    category: 'custom',
    poolSize: 2,
    customOptions: [{ name: 'Movie' }, { name: 'Study' }],
    groupId,
    includeGroupIdeas: true,
  };
  expect(() => parseCreatePick(body)).toThrow('slot');
  expect(validateCreatePick(body)).toEqual(
    expect.arrayContaining([expect.objectContaining({ field: 'includeGroupIdeas' })]),
  );
  expect(parseCreatePick({ ...body, poolSize: 30 }).poolSize).toBe(30);
});
