import { cleanupCache } from '@shared/api/cacheCleanup.ts';
import { SEARCH_TTL_MS } from '@shared/places/cache.ts';
test('cleanup passes UTC day and exact existing five-minute TTL cutoff to daily atomic adapter', async () => {
  const now = new Date('2026-10-28T12:00:00Z');
  const rows = [
    new Date(now.getTime() - SEARCH_TTL_MS - 1).toISOString(),
    new Date(now.getTime() - SEARCH_TTL_MS).toISOString(),
    new Date(now.getTime() - SEARCH_TTL_MS + 1).toISOString(),
  ];
  const deleteExpiredOnce = jest.fn(async (_day: string, cutoff: string) => ({
    removed: rows.filter((t) => t <= cutoff).length,
    ran: true,
  }));
  expect(await cleanupCache({ deleteExpiredOnce }, now)).toEqual({
    status: 'ok',
    removed: 2,
    ran: true,
  });
  expect(deleteExpiredOnce).toHaveBeenCalledWith('2026-10-28', '2026-10-28T11:55:00.000Z');
});
test('absent table adapter is explicit; cleanup failure does not throw or discard deadline work', async () => {
  expect(await cleanupCache()).toMatchObject({
    status: 'blocked',
    removed: 0,
    reason: 'PLACE_CACHE_NOT_AVAILABLE',
  });
  expect(
    await cleanupCache({
      deleteExpiredOnce: async () => {
        throw new Error('private DB details');
      },
    }),
  ).toEqual({ status: 'partial_failure', removed: 0, reason: 'CACHE_CLEANUP_FAILED' });
});
