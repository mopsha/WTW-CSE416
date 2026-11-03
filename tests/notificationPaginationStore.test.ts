import type { NotifyStore } from '@shared/api/notify.ts';
const mockQuery = {
  select: jest.fn(),
  eq: jest.fn(),
  or: jest.fn(),
  order: jest.fn(),
  limit: jest.fn(),
};
jest.mock('../supabase/functions/api/serviceClient.ts', () => ({
  createServiceClient: () => ({ from: () => mockQuery }),
}));
const { createNotifyStore } = jest.requireActual<{ createNotifyStore(): NotifyStore }>(
  '../supabase/functions/api/notifyStore.ts',
);
test('older-page predicate stays scoped to verified user and preserves microsecond ties', async () => {
  for (const name of ['select', 'eq', 'or', 'order'] as const)
    mockQuery[name].mockReturnValue(mockQuery);
  mockQuery.limit.mockResolvedValue({ data: [], error: null });
  const before = {
    createdAt: '2026-11-03T12:00:00.123456+00:00',
    id: '00000000-0000-4000-8000-000000000001',
  };
  await expect(createNotifyStore().list('verified-user', 51, before)).resolves.toEqual([]);
  expect(mockQuery.eq).toHaveBeenCalledWith('user_id', 'verified-user');
  expect(mockQuery.or).toHaveBeenCalledWith(
    `created_at.lt.${before.createdAt},and(created_at.eq.${before.createdAt},id.lt.${before.id})`,
  );
  expect(mockQuery.order.mock.calls).toEqual([
    ['created_at', { ascending: false }],
    ['id', { ascending: false }],
  ]);
  expect(mockQuery.limit).toHaveBeenCalledWith(51);
});
