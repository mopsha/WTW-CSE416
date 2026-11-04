import { deleteAccount, type AccountStore } from '@shared/api/account.ts';
import { errorResponse } from '@shared/api/errors.ts';

const mockDeleteUser = jest.fn();
const mockDeletePhotos = jest.fn<Promise<void>, [string]>();
jest.mock('../supabase/functions/api/avatarStore.ts', () => ({
  deleteAccountPhotos: (id: string) => mockDeletePhotos(id),
}));
jest.mock('../supabase/functions/api/serviceClient.ts', () => ({
  createServiceClient: () => ({ auth: { admin: { deleteUser: mockDeleteUser } } }),
}));
// Load the adapter with its Deno-only service client mocked, keeping app tsc separate.
const { createAccountStore } = jest.requireActual<{ createAccountStore(): AccountStore }>(
  '../supabase/functions/api/accountStore.ts',
);

beforeEach(() => {
  mockDeleteUser.mockReset();
  mockDeletePhotos.mockReset();
});

test('deletes the Auth user with the admin API and reports ok', async () => {
  mockDeleteUser.mockResolvedValue({ data: {}, error: null });
  await expect(deleteAccount(createAccountStore(), 'user-1')).resolves.toEqual({ status: 'ok' });
  expect(mockDeleteUser).toHaveBeenCalledTimes(1);
  expect(mockDeleteUser).toHaveBeenLastCalledWith('user-1');
  expect(mockDeletePhotos).toHaveBeenCalledWith('user-1');
  expect(mockDeletePhotos.mock.invocationCallOrder[0]).toBeLessThan(
    mockDeleteUser.mock.invocationCallOrder[0]!,
  );
});

test('Storage failure stops Auth deletion so cleanup can be retried', async () => {
  mockDeletePhotos.mockRejectedValueOnce(new Error('Photo cleanup failed'));
  await expect(createAccountStore().deleteUser('user-1')).rejects.toThrow('Photo cleanup failed');
  expect(mockDeleteUser).not.toHaveBeenCalled();
});

test('a user who is already gone counts as deleted (a retried request)', async () => {
  mockDeleteUser.mockResolvedValue({
    data: null,
    error: { status: 404, message: 'User not found' },
  });
  await expect(createAccountStore().deleteUser('user-1')).resolves.toBeUndefined();
});

test('any other failure is a 500 without Auth details', async () => {
  mockDeleteUser.mockResolvedValue({
    data: null,
    error: { status: 500, message: 'Database error deleting user: secret' },
  });
  const error = await createAccountStore()
    .deleteUser('user-1')
    .catch((e: unknown) => e);
  const response = errorResponse(error);
  expect(response.status).toBe(500);
  expect(JSON.stringify(response)).not.toContain('secret');
});
