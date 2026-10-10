import { ApiError } from '@shared/api/errors.ts';
import { closePick, type ClosingSnapshot, type ClosingStore } from '@shared/api/closing.ts';

const snapshot = (overrides: Partial<ClosingSnapshot> = {}): ClosingSnapshot => ({
  id: 'pick',
  hostId: 'host',
  state: 'swiping',
  center: { lat: 0, lng: 0 },
  closeThreshold: 100,
  deadlineAt: null,
  participantIds: ['host', 'guest'],
  candidates: ['a', 'b', 'c', 'd'].map((placeId) => ({ placeId, lat: 0, lng: 0 })),
  preferences: [],
  version: '1',
  winnerPlaceId: null,
  finalistIds: [],
  ...overrides,
});

function fixture(pick: ClosingSnapshot | null = snapshot()) {
  return {
    loadForClose: jest.fn().mockResolvedValue(pick),
    applyClose: jest.fn().mockResolvedValue(undefined),
  } satisfies ClosingStore;
}

test('a missing Pick is a 404 for a host close, a silent no-op for the system', async () => {
  const store = fixture(null);
  await expect(closePick(store, 'pick', 'host', 'host')).rejects.toMatchObject({ status: 404 });
  expect(await closePick(store, 'pick', 'system', null)).toBeNull();
});

test('only the host can force-close', async () => {
  const store = fixture();
  await expect(closePick(store, 'pick', 'host', 'guest')).rejects.toMatchObject({ status: 403 });
  expect(store.applyClose).not.toHaveBeenCalled();
});

test('a host close works even when nothing is due yet', async () => {
  const store = fixture();
  const result = await closePick(store, 'pick', 'host', 'host');
  expect(result?.state).toBe('final_vote');
  expect(store.applyClose).toHaveBeenCalledWith(
    'pick',
    '1',
    'host',
    'host',
    expect.objectContaining({ state: 'final_vote' }),
  );
});

test('a system close is a no-op until the threshold or deadline is actually due', async () => {
  const store = fixture(snapshot({ closeThreshold: 100 }));
  expect(await closePick(store, 'pick', 'system', null)).toBeNull();
  expect(store.applyClose).not.toHaveBeenCalled();
});

test('a system close fires once every participant has answered every candidate', async () => {
  // Everyone says Yes to "a" and No to the rest: a clear winner once both are done.
  const preferences = ['host', 'guest'].flatMap((userId) => [
    { userId, placeId: 'a', value: 2 as const },
    { userId, placeId: 'b', value: 0 as const },
    { userId, placeId: 'c', value: 0 as const },
    { userId, placeId: 'd', value: 0 as const },
  ]);
  const store = fixture(snapshot({ preferences }));
  const result = await closePick(store, 'pick', 'system', null);
  expect(result?.state).toBe('completed');
  expect(result?.winnerPlaceId).toBe('a');
});

test('persists a clear winner, hiding scores from the result', async () => {
  const preferences = ['host', 'guest'].map((userId) => ({ userId, placeId: 'a', value: 2 as const }));
  const store = fixture(snapshot({ candidates: [{ placeId: 'a', lat: 0, lng: 0 }], preferences }));
  const result = await closePick(store, 'pick', 'host', 'host');
  expect(result).toEqual({ state: 'completed', winnerPlaceId: 'a', finalists: [] });
  expect(JSON.stringify(result)).not.toMatch(/score|distanceM/);
});

test('rejects closing a Pick with no candidates', async () => {
  const store = fixture(snapshot({ candidates: [] }));
  await expect(closePick(store, 'pick', 'host', 'host')).rejects.toMatchObject({ status: 409 });
});

test('is idempotent: a second close reports the already-settled decision', async () => {
  const closed = snapshot({ state: 'final_vote', finalistIds: ['a', 'b', 'c', 'd'] });
  const store = fixture(closed);
  const result = await closePick(store, 'pick', 'host', 'host');
  expect(result).toEqual({ state: 'final_vote', winnerPlaceId: null, finalists: ['a', 'b', 'c', 'd'] });
  expect(store.applyClose).not.toHaveBeenCalled();
});

test('a lost race (stale version conflict) also resolves idempotently', async () => {
  const store = fixture();
  store.loadForClose
    .mockResolvedValueOnce(snapshot())
    .mockResolvedValueOnce(snapshot({ state: 'completed', winnerPlaceId: 'a' }));
  store.applyClose.mockRejectedValue(new ApiError(409, 'PICK_CONFLICT', 'stale'));
  const result = await closePick(store, 'pick', 'host', 'host');
  expect(result).toEqual({ state: 'completed', winnerPlaceId: 'a', finalists: [] });
});

test('rejects closing a canceled Pick as a host call', async () => {
  const store = fixture(snapshot({ state: 'canceled' }));
  await expect(closePick(store, 'pick', 'host', 'host')).rejects.toMatchObject({ status: 409 });
});
