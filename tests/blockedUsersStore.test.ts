import type { SafetyStore } from '@shared/api/safety.ts';
const mockBlocks = { select: jest.fn(), eq: jest.fn(), order: jest.fn() };
const mockProfiles = { select: jest.fn(), in: jest.fn() };
const mockFrom = jest.fn((table: string) => (table === 'blocks' ? mockBlocks : mockProfiles));
jest.mock('../supabase/functions/api/serviceClient.ts', () => ({
  createServiceClient: () => ({ from: mockFrom }),
}));
const { createSafetyStore } = jest.requireActual<{ createSafetyStore(): SafetyStore }>(
  '../supabase/functions/api/safetyStore.ts',
);
beforeEach(() => {
  jest.clearAllMocks();
  mockBlocks.select.mockReturnValue(mockBlocks);
  mockBlocks.eq.mockReturnValue(mockBlocks);
  mockProfiles.select.mockReturnValue(mockProfiles);
  mockBlocks.order.mockResolvedValue({
    data: [{ blocked_id: 'blocked', created_at: 'date' }],
    error: null,
  });
  mockProfiles.in.mockResolvedValue({
    data: [{ id: 'blocked', display_name: 'Name', favorite_cuisine: 'SECRET' }],
    error: null,
  });
});
test('lists only caller-owned blocks and whitelists basic names', async () => {
  expect(await createSafetyStore().listBlocks!('me')).toEqual([
    { userId: 'blocked', displayName: 'Name' },
  ]);
  expect(mockBlocks.eq).toHaveBeenCalledWith('blocker_id', 'me');
  expect(mockProfiles.in).toHaveBeenCalledWith('id', ['blocked']);
  expect(mockProfiles.select).toHaveBeenCalledWith('id, display_name');
});
test('empty list never queries unrelated profiles', async () => {
  mockBlocks.order.mockResolvedValue({ data: [], error: null });
  expect(await createSafetyStore().listBlocks!('me')).toEqual([]);
  expect(mockProfiles.select).not.toHaveBeenCalled();
});
test('query failure does not leak database details', async () => {
  mockBlocks.order.mockResolvedValue({
    data: null,
    error: { code: 'XX000', message: 'SECRET database' },
  });
  await expect(createSafetyStore().listBlocks!('me')).rejects.not.toThrow('SECRET');
});
