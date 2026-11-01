import { errorResponse } from '@shared/api/errors.ts';
import type { LifecycleStore } from '@shared/api/lifecycle.ts';

const mockRpc = jest.fn();
jest.mock('../supabase/functions/api/serviceClient.ts', () => ({
  createServiceClient: () => ({ rpc: mockRpc }),
}));
// Load the adapter with its Deno-only service client mocked, keeping app tsc separate.
const { createLifecycleStore } = jest.requireActual<{ createLifecycleStore(): LifecycleStore }>(
  '../supabase/functions/api/lifecycleStore.ts',
);

beforeEach(() => mockRpc.mockReset());

test('uses the SQL argument names for every operation', async () => {
  const store = createLifecycleStore();
  mockRpc.mockResolvedValue({ data: { id: 'new-pick' }, error: null });
  await store.createPick('host', {
    category: 'food',
    center: { lat: 1, lng: 2 },
    radiusM: 500,
    poolSize: 20,
    closeThreshold: 100,
    deadlineAt: null,
  });
  expect(mockRpc).toHaveBeenLastCalledWith('pick_create_filtered', {
    p_host_id: 'host',
    p_category: 'food',
    p_price_max: null,
    p_open_now: false,
    p_center_lat: 1,
    p_center_lng: 2,
    p_radius_m: 500,
    p_pool_size: 20,
    p_deadline_at: null,
    p_close_threshold: 100,
  });

  mockRpc.mockResolvedValue({ data: null, error: null });
  await store.load('pick', 'host');
  expect(mockRpc).toHaveBeenLastCalledWith('pick_load_filtered', { p_pick_id: 'pick', p_user_id: 'host' });

  const candidates = [{ placeId: 'a', snapshot: { lat: 0, lng: 0 } }];
  await store.start('pick', 'host', candidates);
  expect(mockRpc).toHaveBeenLastCalledWith('pick_start', {
    p_pick_id: 'pick',
    p_user_id: 'host',
    p_candidates: candidates,
  });

  await store.refresh('pick', 'host', candidates);
  expect(mockRpc).toHaveBeenLastCalledWith('pick_refresh', {
    p_pick_id: 'pick',
    p_user_id: 'host',
    p_candidates: candidates,
  });

  await store.cancel('pick', 'host', 'Rained out');
  expect(mockRpc).toHaveBeenLastCalledWith('pick_cancel', {
    p_pick_id: 'pick',
    p_user_id: 'host',
    p_reason: 'Rained out',
  });
});

test.each([
  ['PT400', 400],
  ['PT403', 403],
  ['PT404', 404],
  ['PT409', 409],
  ['XX000', 500],
  ['PGRST202', 503],
])('maps database %s to safe HTTP %s errors', async (code, status) => {
  mockRpc.mockResolvedValue({ data: null, error: { code, message: 'secret DB details' } });
  try {
    await createLifecycleStore().load('pick', 'host');
    throw new Error('expected load to reject');
  } catch (error) {
    const response = errorResponse(error);
    expect(response.status).toBe(status);
    expect(JSON.stringify(response)).not.toContain('secret DB details');
  }
});
