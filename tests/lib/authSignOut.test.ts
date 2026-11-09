import { clearPendingProfile } from '@/lib/pendingProfile';
import { auth } from '@/lib/auth';
const mockSignOut = jest.fn();
jest.mock('@/lib/config', () => ({ USE_MOCK: false }));
jest.mock('@/lib/supabase', () => ({ getSupabase: () => ({ auth: { signOut: mockSignOut } }) }));
jest.mock('@/lib/pendingProfile', () => ({
  clearPendingProfile: jest.fn().mockResolvedValue(undefined),
}));
beforeEach(() => {
  mockSignOut.mockReset();
  jest.mocked(clearPendingProfile).mockClear();
});
test('delegates logout to the existing Supabase session lifecycle', async () => {
  mockSignOut.mockResolvedValue({ error: null });
  await expect(auth.signOut()).resolves.toBeUndefined();
  expect(mockSignOut).toHaveBeenCalledTimes(1);
  expect(clearPendingProfile).toHaveBeenCalledTimes(1);
});
test('failed SDK signout does not silently report success', async () => {
  mockSignOut.mockResolvedValue({ error: { message: 'PRIVATE server detail' } });
  await expect(auth.signOut()).rejects.toThrow('Could not sign out');
  await expect(auth.signOut()).rejects.not.toThrow('PRIVATE');
});

test('cannot sign out across an uncleared persistent intent', async () => {
  jest.mocked(clearPendingProfile).mockRejectedValueOnce(new Error('Could not clear pending link'));
  await expect(auth.signOut()).rejects.toThrow('Could not clear pending link');
  expect(mockSignOut).not.toHaveBeenCalled();
});
