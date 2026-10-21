import { createCandidateHours } from '@shared/places/candidateHours.ts';

const now = '2026-10-20T12:00:00Z';
beforeEach(() => jest.useFakeTimers().setSystemTime(new Date(now)));
afterEach(() => jest.useRealTimers());

test('fresh owned hours are validated; stale and untagged hours stay unknown', async () => {
  const fetchHours = jest.fn();
  const snapshot = {
    provider: 'mock',
    fetchedAt: now,
    timezone: 'UTC',
    openingHours: { periods: [], alwaysOpen: true },
  };
  const candidates = [
    { placeId: 'fresh', snapshot },
    { placeId: 'stale', snapshot: { ...snapshot, fetchedAt: '2020-01-01' } },
    { placeId: 'legacy', snapshot: { ...snapshot, provider: undefined } },
  ];
  const before = structuredClone(candidates);
  const result = await createCandidateHours({ fetchHours })(candidates);
  expect(result.map((h) => h.openNow)).toEqual([true, null, null]);
  expect(fetchHours).not.toHaveBeenCalled();
  expect(candidates).toEqual(before);
});

test('Google provenance fetches current hours once per ID and isolates provider failures', async () => {
  const fetchHours = jest.fn(async (placeId: string) => {
    if (placeId === 'bad') throw new Error('private provider error');
    return {
      placeId,
      provider: 'google' as const,
      fetchedAt: now,
      openingHours: null,
      currentOpenNow: true,
    };
  });
  const candidates = ['good', 'bad', 'good'].map((placeId) => ({
    placeId,
    snapshot: { provider: 'google', openingHours: { closed: true } },
  }));
  const before = structuredClone(candidates);
  const result = await createCandidateHours({ fetchHours })(candidates);
  expect(fetchHours).toHaveBeenCalledTimes(2);
  expect(result.map((h) => [h.placeId, h.openNow])).toEqual([
    ['good', true],
    ['bad', null],
  ]);
  expect(candidates).toEqual(before);
  expect(JSON.stringify(result)).not.toContain('private');
});
