import type { NotifyStore } from '@shared/api/notify.ts';
const mockRpc = jest.fn();
jest.mock('../supabase/functions/api/serviceClient.ts', () => ({
  createServiceClient: () => ({ rpc: mockRpc }),
}));
const { createNotifyStore } = jest.requireActual<{ createNotifyStore(): NotifyStore }>(
  '../supabase/functions/api/notifyStore.ts',
);
test('the relevance-filtered page stays scoped to the verified user and preserves microsecond cursors', async () => {
  mockRpc.mockResolvedValue({ data: [], error: null });
  const before = {
    createdAt: '2026-11-03T12:00:00.123456+00:00',
    id: '00000000-0000-4000-8000-000000000001',
  };
  await expect(createNotifyStore().list('verified-user', 51, before)).resolves.toEqual([]);
  expect(mockRpc).toHaveBeenCalledWith('notification_feed', {
    p_user: 'verified-user',
    p_limit: 51,
    p_before: before.createdAt,
    p_before_id: before.id,
  });
});
