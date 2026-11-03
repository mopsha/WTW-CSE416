import type { PlaceCache, SearchCacheEntry } from '@shared/places/cache.ts';
import type { CacheCleanupStore } from '@shared/api/cacheCleanup.ts';

const mockUpsert = jest.fn();
const mockRpc = jest.fn();
const mockFrom = jest.fn();
const mockDelete = jest.fn();
const mockEq = jest.fn();
const mockLt = jest.fn();
jest.mock('../supabase/functions/api/serviceClient.ts', () => ({
  createServiceClient: () => ({ from: mockFrom, rpc: mockRpc }),
}));
const { createPlaceCache, createCacheCleanupStore } = jest.requireActual<{
  createPlaceCache(): PlaceCache;
  createCacheCleanupStore(): CacheCleanupStore;
}>('../supabase/functions/api/placeCacheStore.ts');
beforeEach(() => {
  mockUpsert.mockReset();
  mockRpc.mockReset();
  mockFrom.mockReset().mockReturnValue({ upsert: mockUpsert, delete: mockDelete });
  mockDelete.mockReset().mockReturnValue({ eq: mockEq });
  mockEq.mockReset().mockReturnValue({ lt: mockLt });
  mockLt.mockReset().mockResolvedValue({ error: null });
});

test('durable Google cache strips runtime response content and stores only IDs', async () => {
  mockUpsert.mockResolvedValue({ error: null });
  const entry = {
    key: 'google:test',
    query: 'query',
    fetchedAt: '2026-11-02T00:00:00Z',
    provider: 'google',
    placeIds: ['id'],
    candidates: [{ name: 'restricted' }],
    lat: 40,
  } as SearchCacheEntry;
  await createPlaceCache().set(entry);
  expect(mockUpsert).toHaveBeenCalledWith({
    key: entry.key,
    fetched_at: entry.fetchedAt,
    entry: {
      key: entry.key,
      query: entry.query,
      fetchedAt: entry.fetchedAt,
      provider: 'google',
      placeIds: ['id'],
    },
  });
});
test('restricted Google content cannot enter the durable mock cache', async () => {
  await expect(
    createPlaceCache().set({
      key: 'mock:test',
      query: 'query',
      fetchedAt: 'now',
      provider: 'mock',
      candidates: [
        {
          placeId: 'id',
          name: 'restricted',
          category: 'food',
          lat: 40,
          lng: -73,
          provider: 'google',
          retention: 'request',
        },
      ],
    }),
  ).rejects.toThrow('Restricted content');
  expect(mockUpsert).not.toHaveBeenCalled();
});
test('cleanup forwards the UTC day and TTL cutoff to the atomic RPC', async () => {
  mockRpc.mockResolvedValue({ data: { ran: true, removed: 3 }, error: null });
  await expect(
    createCacheCleanupStore().deleteExpiredOnce('2026-11-02', '2026-11-01T23:55:00Z'),
  ).resolves.toEqual({ ran: true, removed: 3 });
  expect(mockRpc).toHaveBeenCalledWith('cleanup_place_cache', {
    p_day: '2026-11-02',
    p_cutoff: '2026-11-01T23:55:00Z',
  });
});

test.each([true, false])(
  'sweep removes only old message events even when cache ran=%p',
  async (ran) => {
    mockRpc.mockResolvedValue({ data: { ran, removed: 0 }, error: null });
    await createCacheCleanupStore().deleteExpiredOnce('2026-11-03', '2026-11-03T11:55:00Z');
    expect(mockFrom).toHaveBeenCalledWith('rate_limit_events');
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockEq).toHaveBeenCalledWith('action', 'message_send');
    expect(mockLt).toHaveBeenCalledWith('created_at', '2026-11-02T00:00:00.000Z');
  },
);
test('event deletion errors surface to sweep status and retry despite claimed cache day', async () => {
  mockRpc.mockResolvedValue({ data: { ran: false, removed: 0 }, error: null });
  mockLt.mockResolvedValueOnce({ error: { message: 'private database detail' } });
  await expect(
    createCacheCleanupStore().deleteExpiredOnce('2026-11-03', '2026-11-03T11:55:00Z'),
  ).rejects.toThrow('Rate limit event cleanup failed');
  await expect(
    createCacheCleanupStore().deleteExpiredOnce('2026-11-03', '2026-11-03T11:55:00Z'),
  ).resolves.toEqual({ ran: false, removed: 0 });
});
