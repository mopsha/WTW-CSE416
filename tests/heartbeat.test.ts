import { ApiError, errorResponse, parseSwipe } from '@shared/api/errors.ts';
import { rank, swipe, type HeartbeatStore, type PickSnapshot } from '@shared/api/heartbeat.ts';

const snapshot = (): PickSnapshot => ({
  id: 'pick',
  hostId: 'host',
  state: 'swiping',
  center: { lat: 0, lng: 0 },
  participantIds: ['host', 'guest'],
  version: '1',
  preferences: [],
  candidates: ['a', 'b', 'c', 'd'].map((placeId) => ({ placeId, lat: 0, lng: 0 })),
});
function fixture(pick: PickSnapshot | null = snapshot()) {
  return {
    loadPick: jest.fn().mockResolvedValue(pick),
    upsertSwipe: jest.fn().mockResolvedValue(undefined),
    saveRanking: jest.fn().mockResolvedValue(undefined),
  } satisfies HeartbeatStore;
}
test.each([
  null,
  [],
  {},
  { placeId: '', value: 0 },
  { placeId: 'a', value: '2' },
  { placeId: 'a', value: 3 },
])('rejects malformed swipe %j', (body) => {
  expect(() => parseSwipe(body)).toThrow(ApiError);
});
test('normalizes known errors and masks unexpected errors', () => {
  expect(errorResponse(new ApiError(403, 'FORBIDDEN', 'Denied'))).toEqual({
    status: 403,
    body: { error: { code: 'FORBIDDEN', message: 'Denied' } },
  });
  expect(JSON.stringify(errorResponse(new Error('secret database details')))).not.toContain(
    'secret',
  );
  expect(errorResponse('oops').status).toBe(500);
});
test('swipes use authenticated identity, ignoring body userId', async () => {
  const store = fixture();
  await swipe(store, 'pick', 'guest', { placeId: 'a', value: 2, userId: 'host' });
  expect(store.upsertSwipe).toHaveBeenCalledWith('pick', 'guest', { placeId: 'a', value: 2 });
});
test.each([
  [null, 'host', 404],
  [snapshot(), 'outsider', 403],
  [{ ...snapshot(), state: 'completed' as const }, 'host', 409],
] as const)('rejects inaccessible or closed Picks', async (pick, user, status) => {
  const store = fixture(pick);
  await expect(swipe(store, 'pick', user, { placeId: 'a', value: 1 })).rejects.toMatchObject({
    status,
  });
  expect(store.upsertSwipe).not.toHaveBeenCalled();
});
test('rejects candidate outside Pick', async () => {
  const store = fixture();
  await expect(
    swipe(store, 'pick', 'host', { placeId: 'outside', value: 0 }),
  ).rejects.toMatchObject({ status: 400 });
  expect(store.upsertSwipe).not.toHaveBeenCalled();
});
test('only host may rank', async () => {
  const store = fixture();
  await expect(rank(store, 'pick', 'guest')).rejects.toMatchObject({ status: 403 });
  expect(store.saveRanking).not.toHaveBeenCalled();
});
test('integrates ranking, persists scores, exposes top 3 and all tied finalists without scores', async () => {
  const store = fixture();
  const result = await rank(store, 'pick', 'host');
  expect(result.results).toEqual(['a', 'b', 'c'].map((placeId, i) => ({ placeId, rank: i + 1 })));
  expect(result.decision.kind).toBe('vote');
  if (result.decision.kind === 'vote') expect(result.decision.finalists).toHaveLength(4);
  expect(JSON.stringify(result)).not.toMatch(/score|coverage|distanceM|consensus/);
  expect(store.saveRanking).toHaveBeenCalledWith(
    'pick',
    'host',
    '1',
    expect.objectContaining({
      state: 'final_vote',
      rows: expect.arrayContaining([
        expect.objectContaining({ score: expect.closeTo(55, 8), finalist: true }),
      ]),
    }),
  );
});
test('persists clear winner and handles empty candidates', async () => {
  const pick = snapshot();
  pick.candidates = pick.candidates.slice(0, 1);
  const store = fixture(pick);
  expect((await rank(store, 'pick', 'host')).decision.kind).toBe('winner');
  expect(store.saveRanking.mock.calls[0]![3]).toMatchObject({
    state: 'completed',
    winnerPlaceId: 'a',
  });
  pick.candidates = [];
  await expect(rank(store, 'pick', 'host')).rejects.toMatchObject({ status: 409 });
});
test('does not report success when persistence conflicts', async () => {
  const store = fixture();
  store.saveRanking.mockRejectedValue(new ApiError(409, 'PICK_CONFLICT', 'Reload'));
  await expect(rank(store, 'pick', 'host')).rejects.toMatchObject({ status: 409 });
});
