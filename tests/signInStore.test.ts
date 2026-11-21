import type { SignInStore } from '@shared/api/signIn.ts';

// The service-role adapter behind POST /auth/password-login (#85, Josh's re-review).
const mockFrom = jest.fn();
const mockGetUserById = jest.fn();
const mockRpc = jest.fn();
jest.mock('../supabase/functions/api/serviceClient.ts', () => ({
  createServiceClient: () => ({
    from: mockFrom,
    rpc: mockRpc,
    auth: { admin: { getUserById: mockGetUserById } },
  }),
}));
const { createSignInStore } = jest.requireActual<{ createSignInStore(): SignInStore }>(
  '../supabase/functions/api/signInStore.ts',
);

beforeEach(() => {
  jest.clearAllMocks();
  mockFrom.mockReturnValue({
    select: () => ({
      eq: () => ({ maybeSingle: async () => ({ data: { id: 'user-1' }, error: null }) }),
    }),
  });
});

test('an admin lookup failure is reported as an outage, not as an unknown username', async () => {
  mockGetUserById.mockResolvedValue({ data: { user: null }, error: { status: 500 } });
  await expect(createSignInStore().emailForUsername('alan')).rejects.toMatchObject({
    status: 503,
  });
});

test('a profile whose account is gone is an unknown username', async () => {
  mockGetUserById.mockResolvedValue({ data: { user: null }, error: { status: 404 } });
  await expect(createSignInStore().emailForUsername('alan')).resolves.toBeNull();
});

test('a charge is the bucket the database spent, and the refund names that bucket', async () => {
  const store = createSignInStore();
  mockRpc.mockResolvedValueOnce({ data: '2026-11-20T21:00', error: null });
  await expect(store.consumeLoginAttempt([{ key: 'global', limit: 600 }])).resolves.toBe(
    '2026-11-20T21:00',
  );
  mockRpc.mockResolvedValueOnce({ data: null, error: null });
  await expect(store.consumeLoginAttempt([{ key: 'global', limit: 600 }])).resolves.toBeNull();
  mockRpc.mockResolvedValueOnce({ data: null, error: null });
  await store.refundLoginAttempt(['global'], '2026-11-20T21:00');
  expect(mockRpc).toHaveBeenLastCalledWith('refund_login_limit', {
    p_subjects: ['global'],
    p_bucket: '2026-11-20T21:00',
  });
});
