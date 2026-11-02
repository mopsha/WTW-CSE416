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

const failure = async () =>
  errorResponse(
    await createJoinStore()
      .joinByCode('K7P2QX', 'guest')
      .catch((e: unknown) => e),
  );

test('calls pick_join with the SQL argument names and returns the Pick id', async () => {
  mockRpc.mockResolvedValue({ data: { ok: true, pickId: 'pick-1' }, error: null });
  await expect(createJoinStore().joinByCode('K7P2QX', 'guest')).resolves.toBe('pick-1');
  expect(mockRpc).toHaveBeenLastCalledWith('pick_join', { p_code: 'K7P2QX', p_user_id: 'guest' });
});

test('every failed join is the same 404 (0014 never says why)', async () => {
  mockRpc.mockResolvedValue({ data: { ok: false, reason: 'invalid' }, error: null });
  const response = await failure();
  expect(response.status).toBe(404);
  expect(response.body.error.code).toBe('JOIN_CODE_NOT_FOUND');
});

test('too many failed joins is 429 RATE_LIMITED', async () => {
  mockRpc.mockResolvedValue({ data: { ok: false, reason: 'rate_limited' }, error: null });
  const response = await failure();
  expect(response.status).toBe(429);
  expect(response.body.error.code).toBe('RATE_LIMITED');
});

test.each([
  ['PT403', 403, 'FORBIDDEN'],
  ['XX000', 500, 'INTERNAL_ERROR'],
  ['PGRST202', 503, 'DATABASE_NOT_READY'],
])('maps database %s to HTTP %s %s without leaking details', async (code, status, apiCode) => {
  mockRpc.mockResolvedValue({ data: null, error: { code, message: 'secret DB details' } });
  const response = await failure();
  expect(response.status).toBe(status);
  expect(response.body.error.code).toBe(apiCode);
  expect(JSON.stringify(response)).not.toContain('secret DB details');
});
