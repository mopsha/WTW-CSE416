import { auth } from '@/lib/auth';

// Settings → Password and the welcome screen only change the account they were opened for.
const mockGetSession = jest.fn();
const mockUpdateUser = jest.fn();
const mockReauthenticate = jest.fn();
const mockFetch = jest.fn();
jest.mock('@/lib/config', () => ({
  USE_MOCK: false,
  SUPABASE_URL: 'https://wtw.example',
  SUPABASE_ANON_KEY: 'anon',
  API_BASE_URL: 'https://wtw.example/functions/v1/api',
}));
jest.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    auth: {
      getSession: mockGetSession,
      updateUser: mockUpdateUser,
      reauthenticate: mockReauthenticate,
    },
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  globalThis.fetch = mockFetch as unknown as typeof fetch;
  mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
});

const signedInAs = (id: string) =>
  mockGetSession.mockResolvedValue({
    data: { session: { user: { id }, access_token: `token-${id}` } },
  });

test('a password save from a screen opened for another account changes nothing', async () => {
  signedInAs('someone-else');
  await expect(auth.setPassword('long-enough', { userId: 'me' })).rejects.toMatchObject({
    code: 'account_changed',
  });
  await expect(auth.requestPasswordCode('me')).rejects.toMatchObject({ code: 'account_changed' });
  expect(mockFetch).not.toHaveBeenCalled();
});

test('signed out mid-save is refused too', async () => {
  mockGetSession.mockResolvedValue({ data: { session: null } });
  await expect(auth.setPassword('long-enough', { userId: 'me' })).rejects.toMatchObject({
    code: 'account_changed',
  });
  expect(mockFetch).not.toHaveBeenCalled();
});

test('the same account saves, passing the confirmation code through', async () => {
  signedInAs('me');
  await auth.setPassword('long-enough', { userId: 'me', code: '123456' });
  expect(mockFetch).toHaveBeenCalledWith(
    'https://wtw.example/auth/v1/user',
    expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ password: 'long-enough', nonce: '123456' }),
    }),
  );
  await auth.requestPasswordCode('me');
  expect(mockFetch).toHaveBeenLastCalledWith(
    'https://wtw.example/auth/v1/reauthenticate',
    expect.objectContaining({ method: 'GET' }),
  );
});

test('the save is sent with the token of the session that passed the account check', async () => {
  // An account switch right after the check must not redirect the change: the request carries
  // the checked session's own token, and nothing re-reads the (now different) session.
  mockGetSession
    .mockResolvedValueOnce({ data: { session: { user: { id: 'me' }, access_token: 'token-me' } } })
    .mockResolvedValue({
      data: { session: { user: { id: 'someone-else' }, access_token: 'token-else' } },
    });
  await auth.setPassword('long-enough', { userId: 'me' });
  expect(mockGetSession).toHaveBeenCalledTimes(1);
  expect(mockFetch).toHaveBeenCalledTimes(1);
  expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer token-me');
  expect(mockUpdateUser).not.toHaveBeenCalled();
  expect(mockReauthenticate).not.toHaveBeenCalled();
});

test('Supabase errors from the pinned request keep their meaning', async () => {
  signedInAs('me');
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status: 400,
    json: async () => ({ error_code: 'reauthentication_needed', msg: 'Reauth needed' }),
  });
  await expect(auth.setPassword('long-enough', { userId: 'me' })).rejects.toMatchObject({
    code: 'reauth_needed',
  });
  mockFetch.mockRejectedValueOnce(new TypeError('Network request failed'));
  await expect(auth.requestPasswordCode('me')).rejects.toMatchObject({ code: 'unknown' });
});
