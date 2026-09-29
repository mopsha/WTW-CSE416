import { errorResponse } from '@shared/api/errors.ts';
import type { HeartbeatStore, RankingWrite } from '@shared/api/heartbeat.ts';

const mockRpc = jest.fn();
jest.mock('../supabase/functions/api/serviceClient.ts', () => ({
  createServiceClient: () => ({ rpc: mockRpc }),
}));
// Load the adapter with its Deno-only service client mocked, keeping app tsc separate.
const { createStore } = jest.requireActual<{ createStore(): HeartbeatStore }>(
  '../supabase/functions/api/store.ts',
);

beforeEach(() => mockRpc.mockReset());

test('uses the SQL argument names and preserves snapshot/version and ranking payloads', async () => {
  const store = createStore();
  const snapshot = { version: '9007199254740993', participantIds: ['host'] };
  mockRpc.mockResolvedValue({ data: snapshot, error: null });
  expect(await store.loadPick('pick', 'host')).toBe(snapshot);
  expect(mockRpc).toHaveBeenLastCalledWith('heartbeat_load_pick', {
    p_pick_id: 'pick', p_user_id: 'host',
  });
  await store.upsertSwipe('pick', 'guest', { placeId: 'place', value: 2 });
  expect(mockRpc).toHaveBeenLastCalledWith('heartbeat_upsert_swipe', {
    p_pick_id: 'pick', p_user_id: 'guest', p_place_id: 'place', p_value: 2,
  });
  const ranking: RankingWrite = {
    rows: [{ place_id: 'place', rank: 1, score: 100, finalist: false }],
    state: 'completed', winnerPlaceId: 'place',
  };
  await store.saveRanking('pick', 'host', snapshot.version, ranking);
  expect(mockRpc).toHaveBeenLastCalledWith('heartbeat_save_ranking', {
    p_pick_id: 'pick', p_user_id: 'host', p_version: snapshot.version, p_ranking: ranking,
  });
});

test.each([
  ['PT400', 400], ['PT403', 403], ['PT404', 404], ['PT409', 409],
  ['XX000', 500], ['PGRST202', 503],
])('maps database %s to safe HTTP %s errors', async (code, status) => {
  mockRpc.mockResolvedValue({ data: null, error: { code, message: 'secret DB details' } });
  await expect(createStore().loadPick('pick', 'host')).rejects.toBeInstanceOf(Error);
  try {
    await createStore().loadPick('pick', 'host');
  } catch (error) {
    const response = errorResponse(error);
    expect(response.status).toBe(status);
    expect(response.body).toEqual({ error: { code: expect.any(String), message: expect.any(String) } });
    expect(JSON.stringify(response)).not.toContain('secret DB details');
  }
});
