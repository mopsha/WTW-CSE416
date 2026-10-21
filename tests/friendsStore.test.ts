import { errorResponse } from '@shared/api/errors.ts';
import type { FriendsStore } from '@shared/api/friends.ts';

const mockRpc = jest.fn();
jest.mock('../supabase/functions/api/serviceClient.ts', () => ({
  createServiceClient: () => ({ rpc: mockRpc }),
}));
// Load the adapter with its Deno-only service client mocked, keeping app tsc separate.
const { createFriendsStore } = jest.requireActual<{ createFriendsStore(): FriendsStore }>(
  '../supabase/functions/api/friendsStore.ts',
);

beforeEach(() => mockRpc.mockReset());

test('calls the friend_* RPCs with the SQL argument names', async () => {
  mockRpc.mockResolvedValue({ data: [], error: null });
  const s = createFriendsStore();
  await expect(s.list('me')).resolves.toEqual([]);
  expect(mockRpc).toHaveBeenLastCalledWith('friend_list', { p_user_id: 'me' });

  mockRpc.mockResolvedValue({ data: { userId: 'bo', displayName: 'Bo', status: 'pending' } });
  await expect(s.request('me', 'bo@example.com')).resolves.toEqual({
    userId: 'bo',
    displayName: 'Bo',
    status: 'pending',
  });
  expect(mockRpc).toHaveBeenLastCalledWith('friend_request', {
    p_user_id: 'me',
    p_email: 'bo@example.com',
  });

  mockRpc.mockResolvedValue({ data: null, error: null });
  await s.accept('me', 'bo');
  expect(mockRpc).toHaveBeenLastCalledWith('friend_accept', { p_user_id: 'me', p_friend_id: 'bo' });
  await s.remove('me', 'bo');
  expect(mockRpc).toHaveBeenLastCalledWith('friend_remove', { p_user_id: 'me', p_friend_id: 'bo' });
});

test.each([
  ['request', 'PT404', 404, 'USER_NOT_FOUND'],
  ['request', 'PT400', 400, 'CANNOT_FRIEND_SELF'],
  ['request', 'PT403', 403, 'FORBIDDEN'],
  ['accept', 'PT404', 404, 'REQUEST_NOT_FOUND'],
  ['list', 'PGRST202', 503, 'DATABASE_NOT_READY'],
  ['remove', 'XX000', 500, 'INTERNAL_ERROR'],
] as const)(
  '%s maps database %s to HTTP %s %s without leaking details',
  async (method, code, status, apiCode) => {
    mockRpc.mockResolvedValue({ data: null, error: { code, message: 'secret DB details' } });
    const s = createFriendsStore();
    const error = await (method === 'request' ? s.request('me', 'a@b.co') : s[method]('me', 'bo'))
      .then(() => null)
      .catch((e: unknown) => e);
    const response = errorResponse(error);
    expect(response.status).toBe(status);
    expect(response.body.error.code).toBe(apiCode);
    expect(JSON.stringify(response)).not.toContain('secret DB details');
  },
);
