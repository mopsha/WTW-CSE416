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

test('a charge is the reservation the database made, and the refund names only that', async () => {
  const store = createSignInStore();
  const reservation = '7d4f0c1e-0000-4000-8000-000000000001';
  mockRpc.mockResolvedValueOnce({ data: reservation, error: null });
  await expect(store.consumeLoginAttempt([{ key: 'global', limit: 600 }])).resolves.toBe(
    reservation,
  );
  mockRpc.mockResolvedValueOnce({ data: null, error: null });
  await expect(store.consumeLoginAttempt([{ key: 'global', limit: 600 }])).resolves.toBeNull();
  mockRpc.mockResolvedValueOnce({ data: null, error: null });
  await store.refundLoginAttempt(reservation);
  expect(mockRpc).toHaveBeenLastCalledWith('refund_login_limit', { p_reservation: reservation });
});
