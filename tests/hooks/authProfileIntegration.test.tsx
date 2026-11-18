import React from 'react';
import { api } from '@/lib/api';
import { photoSource, loadPhoto, photoState, clearPhotoCache } from '@/lib/photoCache';
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

test('auth events invalidate photo generations before replacement-account results can be consumed', async () => {
  let listener!: (s: AuthSession | null) => void;
  let finish!: (value: { photoUrl: string }) => void;
  jest.mocked(auth.getSession).mockResolvedValue(session);
  jest.mocked(auth.onChange).mockImplementation((value) => {
    listener = value;
    return () => {};
  });
  const resolve = jest
    .spyOn(api, 'discoverPhoto')
    .mockReturnValueOnce(
      new Promise((value) => {
        finish = value;
      }),
    )
    .mockResolvedValue({ photoUrl: 'https://img/B' });
  let tree!: Tree;
  try {
    await act(async () => {
      tree = create(
        <AuthProvider>
          <Consumer />
        </AuthProvider>,
      );
    });
    const a = photoSource('places/p/photos/1', 'user-a');
    const pending = loadPhoto(a);
    await act(async () =>
      listener({ user: { id: 'user-b', email: null }, accessToken: 'other-token' }),
    );
    const b = photoSource('places/p/photos/1', 'user-b');
    await loadPhoto(b);
    expect(resolve).toHaveBeenLastCalledWith('places/p/photos/1', 'user-b');
    finish({ photoUrl: 'https://img/old-A' });
    expect(await pending).toBeNull();
    expect(photoState(b).url).toBe('https://img/B');
    await act(async () => listener(null));
    expect(photoState(b).expired).toBe(true);
  } finally {
    if (tree) await act(async () => tree.unmount());
    resolve.mockRestore();
    clearPhotoCache();
  }
});
