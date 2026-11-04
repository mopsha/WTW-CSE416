import { deleteAccount, type AccountStore } from '@shared/api/account.ts';
import { errorResponse } from '@shared/api/errors.ts';

const mockDeleteUser = jest.fn();
const mockPending = jest.fn();
const mockDeletePhotos = jest.fn<Promise<void>, [string]>();
jest.mock('../supabase/functions/api/avatarStore.ts', () => ({
  deleteAccountPhotos: (id: string) => mockDeletePhotos(id),
}));
jest.mock('../supabase/functions/api/serviceClient.ts', () => ({
  createServiceClient: () => ({
    rpc: mockPending,
    auth: { admin: { deleteUser: mockDeleteUser } },
  }),
}));
// Load the adapter with its Deno-only service client mocked, keeping app tsc separate.
const { createAccountStore, retryPendingAccountDeletions } = jest.requireActual<{
  createAccountStore(): AccountStore;
  retryPendingAccountDeletions(): Promise<{ attempted: number; failed: number }>;
}>('../supabase/functions/api/accountStore.ts');

beforeEach(() => {
  mockDeleteUser.mockReset();
  mockPending.mockReset();
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

test('sweep retries partial Storage deletion without restoring an unsafe profile', async () => {
  mockPending.mockResolvedValue({ data: ['user-1'], error: null });
  mockDeletePhotos.mockRejectedValueOnce(new Error('partial removal'));
  expect(await retryPendingAccountDeletions()).toMatchObject({ attempted: 1, failed: 1 });
  expect(mockDeleteUser).not.toHaveBeenCalled();
  mockDeletePhotos.mockResolvedValueOnce(undefined);
  mockDeleteUser.mockResolvedValueOnce({ error: null });
  expect(await retryPendingAccountDeletions()).toMatchObject({ attempted: 1, failed: 0 });
  expect(mockPending.mock.calls.every(([name]) => name === 'avatar_pending_deletions')).toBe(true);
});

test('uncertain Auth deletion remains retryable, including a later not-found result', async () => {
  let exists = true;
  mockPending.mockImplementation(async () => ({ data: exists ? ['user-1'] : [], error: null }));
  mockDeleteUser.mockImplementation(async () => {
    exists = false; // Model Auth commit plus profile cascade before losing the reply.
    throw new Error('connection lost after commit');
  });
  expect(await retryPendingAccountDeletions()).toMatchObject({ attempted: 1, failed: 1 });
  expect(await retryPendingAccountDeletions()).toMatchObject({ attempted: 0, failed: 0 });
  expect(mockDeleteUser).toHaveBeenCalledTimes(1);
  expect(mockDeletePhotos).toHaveBeenCalledTimes(1);
});
