import { errorResponse } from '@shared/api/errors.ts';
import type { JoinStore } from '@shared/api/join.ts';

const mockRpc = jest.fn();
jest.mock('../supabase/functions/api/serviceClient.ts', () => ({
  createServiceClient: () => ({ rpc: mockRpc }),
}));
// Load the adapter with its Deno-only service client mocked, keeping app tsc separate.
const { createJoinStore } = jest.requireActual<{ createJoinStore(): JoinStore }>(
  '../supabase/functions/api/joinStore.ts',
);

beforeEach(() => mockRpc.mockReset());

test('calls pick_join with the SQL argument names and returns the Pick id', async () => {
  mockRpc.mockResolvedValue({ data: 'pick-1', error: null });
  await expect(createJoinStore().joinByCode('K7P2QX', 'guest')).resolves.toBe('pick-1');
  expect(mockRpc).toHaveBeenLastCalledWith('pick_join', { p_code: 'K7P2QX', p_user_id: 'guest' });
});

test.each([
  ['PT404', 404, 'JOIN_CODE_NOT_FOUND'],
  ['PT409', 409, 'PICK_CLOSED'],
  ['PT403', 403, 'FORBIDDEN'],
  ['XX000', 500, 'INTERNAL_ERROR'],
  ['PGRST202', 503, 'DATABASE_NOT_READY'],
])('maps database %s to HTTP %s %s without leaking details', async (code, status, apiCode) => {
  mockRpc.mockResolvedValue({ data: null, error: { code, message: 'secret DB details' } });
  const error = await createJoinStore()
    .joinByCode('K7P2QX', 'guest')
    .catch((e: unknown) => e);
  const response = errorResponse(error);
  expect(response.status).toBe(status);
  expect(response.body.error.code).toBe(apiCode);
  expect(JSON.stringify(response)).not.toContain('secret DB details');
});
