import { auth } from '@/lib/auth';
const mockSignOut = jest.fn();
jest.mock('@/lib/config', () => ({ USE_MOCK: false }));
jest.mock('@/lib/supabase', () => ({ getSupabase: () => ({ auth: { signOut: mockSignOut } }) }));
beforeEach(() => mockSignOut.mockReset());
test('delegates logout to the existing Supabase session lifecycle', async () => {
  mockSignOut.mockResolvedValue({ error: null });
  await expect(auth.signOut()).resolves.toBeUndefined();
  expect(mockSignOut).toHaveBeenCalledTimes(1);
});
test('failed SDK signout does not silently report success', async () => {
  mockSignOut.mockResolvedValue({ error: { message: 'PRIVATE server detail' } });
  await expect(auth.signOut()).rejects.toThrow('Could not sign out');
  await expect(auth.signOut()).rejects.not.toThrow('PRIVATE');
});
