import { auth } from '@/lib/auth';

// Settings → Password and the welcome screen only change the account they were opened for.
const mockGetSession = jest.fn();
const mockUpdateUser = jest.fn();
const mockReauthenticate = jest.fn();
jest.mock('@/lib/config', () => ({ USE_MOCK: false }));
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
  mockUpdateUser.mockResolvedValue({ error: null });
  mockReauthenticate.mockResolvedValue({ error: null });
});

const signedInAs = (id: string) =>
  mockGetSession.mockResolvedValue({ data: { session: { user: { id } } } });

test('a password save from a screen opened for another account changes nothing', async () => {
  signedInAs('someone-else');
  await expect(auth.setPassword('long-enough', { userId: 'me' })).rejects.toMatchObject({
    code: 'account_changed',
  });
  await expect(auth.requestPasswordCode('me')).rejects.toMatchObject({ code: 'account_changed' });
  expect(mockUpdateUser).not.toHaveBeenCalled();
  expect(mockReauthenticate).not.toHaveBeenCalled();
});

test('signed out mid-save is refused too', async () => {
  mockGetSession.mockResolvedValue({ data: { session: null } });
  await expect(auth.setPassword('long-enough', { userId: 'me' })).rejects.toMatchObject({
    code: 'account_changed',
  });
  expect(mockUpdateUser).not.toHaveBeenCalled();
});

test('the same account saves, passing the confirmation code through', async () => {
  signedInAs('me');
  await auth.setPassword('long-enough', { userId: 'me', code: '123456' });
  expect(mockUpdateUser).toHaveBeenCalledWith({ password: 'long-enough', nonce: '123456' });
  await auth.requestPasswordCode('me');
  expect(mockReauthenticate).toHaveBeenCalledTimes(1);
});
