import React from 'react';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { clearPendingProfile } from '@/lib/pendingProfile';
import { auth, type AuthSession } from '@/lib/auth';
type Tree = { unmount(): void };
const { create, act } = jest.requireActual<{
  create(e: React.ReactElement): Tree;
  act(work: () => void | Promise<void>): Promise<void>;
}>('react-test-renderer');
jest.mock('@/lib/auth', () => ({ auth: { getSession: jest.fn(), onChange: jest.fn() } }));
jest.mock('@/lib/pendingProfile', () => ({
  clearPendingProfile: jest.fn().mockResolvedValue(undefined),
}));
let latest!: ReturnType<typeof useAuth>;
function Consumer() {
  const value = useAuth();
  React.useEffect(() => {
    latest = value;
  }, [value]);
  return null;
}
const session: AuthSession = {
  user: { id: 'user-a', email: 'a@example.com' },
  accessToken: 'token',
};
test.each([session, null])(
  'late stored-session reads cannot overwrite a newer auth event: %p',
  async (event) => {
    let resolve!: (value: AuthSession | null) => void;
    let listener!: (s: AuthSession | null) => void;
    const unsubscribe = jest.fn();
    jest.mocked(auth.getSession).mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    jest.mocked(auth.onChange).mockImplementation((l) => {
      listener = l;
      return unsubscribe;
    });
    let tree!: Tree;
    await act(async () => {
      tree = create(
        <AuthProvider>
          <Consumer />
        </AuthProvider>,
      );
    });
    await act(async () => listener(event));
    await act(async () => resolve(event ? null : session));
    expect(latest.session).toBe(event);
    expect(latest.loading).toBe(false);
    await act(async () => tree.unmount());
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  },
);

test('session refresh preserves pending intent, switching accounts and signing out clear it', async () => {
  jest.mocked(clearPendingProfile).mockClear();
  jest.mocked(auth.getSession).mockResolvedValue(session);
  let listener!: (s: AuthSession | null) => void;
  jest.mocked(auth.onChange).mockImplementation((l) => {
    listener = l;
    return () => {};
  });
  let tree!: Tree;
  await act(async () => {
    tree = create(
      <AuthProvider>
        <Consumer />
      </AuthProvider>,
    );
  });
  await act(async () => listener({ ...session, accessToken: 'refreshed' }));
  expect(clearPendingProfile).not.toHaveBeenCalled();
  await act(async () => listener({ ...session, user: { id: 'user-b', email: null } }));
  expect(clearPendingProfile).toHaveBeenCalledTimes(1);
  await act(async () => listener(null));
  expect(clearPendingProfile).toHaveBeenCalledTimes(2);
  await act(async () => tree.unmount());
});
