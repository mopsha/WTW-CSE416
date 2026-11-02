import type { HangStore } from '@shared/api/hang.ts';
const mockRpc = jest.fn();
jest.mock('../supabase/functions/api/serviceClient.ts', () => ({
  createServiceClient: () => ({ rpc: mockRpc }),
}));
const { createHangStore } = jest.requireActual<{ createHangStore(): HangStore }>(
  '../supabase/functions/api/hangStore.ts',
);
beforeEach(() => mockRpc.mockReset());
test('real adapter uses graph/atomic RPCs rather than raw service writes', async () => {
  mockRpc.mockResolvedValue({ data: {}, error: null });
  const store = createHangStore();
  await store.listOwn('u', 'now');
  expect(mockRpc).toHaveBeenLastCalledWith('hang_list', { p_user: 'u' });
  await store.respondAuthorized!('p', 'u', 'down');
  expect(mockRpc).toHaveBeenLastCalledWith('hang_respond', {
    p_id: 'p',
    p_user: 'u',
    p_status: 'down',
  });
  const input = {
    category: 'food' as const,
    center: { lat: 40, lng: -73 },
    radiusM: 1000,
    poolSize: 5,
    deadlineAt: null,
    closeThreshold: 100,
  };
  await store.createPickForDown!('p', 'u', input);
  expect(mockRpc).toHaveBeenLastCalledWith('hang_create_pick', {
    p_id: 'p',
    p_user: 'u',
    p_input: input,
  });
});
test.each([
  ['PT404', 404],
  ['PT403', 403],
  ['PT409', 409],
  ['PT429', 429],
  ['XX000', 503],
])('Hang adapter maps %s safely', async (code, status) => {
  mockRpc.mockResolvedValue({
    error: { code, message: code === 'XX000' ? 'secret database detail' : 'Hang unavailable' },
    data: null,
  });
  await expect(createHangStore().respondAuthorized!('p', 'u', 'down')).rejects.toMatchObject({
    status,
  });
});
test('malformed or unauthorized ids cannot trigger an unrestricted service table lookup', async () => {
  await expect(createHangStore().load('invalid', 'u')).resolves.toBeNull();
  expect(mockRpc).not.toHaveBeenCalled();
});
