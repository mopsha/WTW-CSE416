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
const mockSignIn = jest.fn();
const mockCreateClient = jest.fn((..._args: unknown[]) => ({
  auth: { signInWithPassword: mockSignIn },
}));
jest.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
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

function env(secretKeys?: string) {
  const values: Record<string, string | undefined> = {
    SUPABASE_URL: 'https://x.test',
    SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SECRET_KEYS: secretKeys,
  };
  (globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => values[k] } };
}
afterAll(() => {
  delete (globalThis as { Deno?: unknown }).Deno;
});

test("the caller's address is forwarded to Supabase, with the secret key that requires", async () => {
  env('{"default":"sb_secret_test"}');
  mockSignIn.mockResolvedValue({
    data: { session: { access_token: 'a', refresh_token: 'r' } },
    error: null,
  });
  await expect(createSignInStore().passwordSignIn('a@b.co', 'x', '1.1.1.1')).resolves.toEqual({
    accessToken: 'a',
    refreshToken: 'r',
  });
  expect(mockCreateClient).toHaveBeenCalledWith(
    'https://x.test',
    'sb_secret_test',
    expect.objectContaining({
      global: { headers: { 'sb-forwarded-for': '1.1.1.1' }, fetch: expect.any(Function) },
    }),
  );
  // The SDK adds the key as a Bearer token too; a secret key belongs only in apikey.
  const options = mockCreateClient.mock.calls[0]![2] as { global: { fetch: typeof fetch } };
  const sent = jest.spyOn(globalThis, 'fetch').mockResolvedValue({} as Response);
  await options.global.fetch('https://x.test/auth/v1/token', {
    headers: { apikey: 'sb_secret_test', Authorization: 'Bearer sb_secret_test' },
  });
  const headers = new Headers(sent.mock.calls[0]![1]!.headers);
  sent.mockRestore();
  expect(headers.get('authorization')).toBeNull();
  expect(headers.get('apikey')).toBe('sb_secret_test');
});

test.each([
  ['no secret key', undefined, '1.1.1.1'],
  ['unreadable secret keys', 'not json', '1.1.1.1'],
  ['only legacy keys', '{"default":"eyJlegacy"}', '1.1.1.1'],
  ['an unknown address', '{"default":"sb_secret_test"}', null],
])('with %s, sign-in uses the anon key and forwards nothing', async (_name, keys, client) => {
  env(keys);
  mockSignIn.mockResolvedValue({
    data: { session: null },
    error: { code: 'invalid_credentials', status: 400 },
  });
  await expect(createSignInStore().passwordSignIn('a@b.co', 'x', client)).resolves.toBeNull();
  expect(mockCreateClient).toHaveBeenCalledWith(
    'https://x.test',
    'anon',
    expect.not.objectContaining({ global: expect.anything() }),
  );
});

test("Supabase's rate limit is reported as one; other failures are an outage", async () => {
  env();
  mockSignIn.mockResolvedValueOnce({
    data: { session: null },
    error: { code: 'over_request_rate_limit', status: 429 },
  });
  await expect(createSignInStore().passwordSignIn('a@b.co', 'x', null)).rejects.toMatchObject({
    status: 429,
  });
  mockSignIn.mockResolvedValueOnce({ data: { session: null }, error: { status: 500 } });
  await expect(createSignInStore().passwordSignIn('a@b.co', 'x', null)).rejects.toMatchObject({
    status: 503,
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
