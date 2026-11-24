import React from 'react';
import { router } from 'expo-router';
import { redirectSystemPath } from '../../app/+native-intent';
import { takePendingFriends } from '@/lib/pendingFriends';
import RootLayout from '../../app/_layout';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
type Node = { props: { guard?: boolean }; findAllByProps(p: object): Node[] };
let mockPathname = '/';
const { create, act } = jest.requireActual<{
  create(e: React.ReactElement): {
    root: { findAllByType(t: string): Node[] };
    update(e: React.ReactElement): void;
    unmount(): void;
  };
  act(work: () => void | Promise<void>): Promise<void>;
}>('react-test-renderer');
jest.mock('@expo-google-fonts/poppins', () => ({ useFonts: () => [true, null] }));
jest.mock('expo-splash-screen', () => ({ preventAutoHideAsync: jest.fn(), hideAsync: jest.fn() }));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('react-native-gesture-handler', () => ({
  GestureHandlerRootView: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/hooks/useAuth', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: jest.fn(),
}));
jest.mock('@/hooks/useProfile', () => ({
  ProfileProvider: ({ children }: { children: React.ReactNode }) => children,
  useProfile: jest.fn(),
}));
jest.mock('@/lib/notify', () => ({
  configureNotifications: jest.fn(),
  onNotificationTap: () => () => {},
}));
jest.mock('@/lib/push', () => ({ registerForPush: jest.fn() }));
jest.mock('@/lib/pendingJoin', () => ({ takePendingJoin: () => null }));
jest.mock('@/lib/pendingInvite', () => ({ takePendingInvite: async () => null }));
jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  const Stack = ({ children }: { children: React.ReactNode }) => children;
  Stack.Protected = function Protected(p: { children: React.ReactNode }) {
    return React.createElement('test-protected', p, p.children);
  };
  Stack.Screen = function Screen(p: object) {
    return React.createElement('test-screen', p);
  };
  return {
    Stack,
    router: { push: jest.fn(), replace: jest.fn(), navigate: jest.fn(), dismissTo: jest.fn() },
    usePathname: () => mockPathname,
  };
});
test.each([null, 'valid_user'])(
  'Groups uses the same required-identity guard as tabs: username=%p',
  async (username) => {
    jest.mocked(useAuth).mockReturnValue({
      session: { user: { id: 'me', email: 'me@example.com' }, accessToken: 'token' },
      loading: false,
    });
    jest.mocked(useProfile).mockReturnValue({
      displayName: 'Me',
      username,
      loading: false,
      optionalSetupPending: false,
    } as ReturnType<typeof useProfile>);
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<RootLayout />);
    });
    const guard = tree.root
      .findAllByType('test-protected')
      .find((n) => n.findAllByProps({ name: 'groups' }).length);
    expect(guard).toBeDefined();
    expect(guard!.props.guard).toBe(username !== null);
    await act(async () => tree.unmount());
  },
);

test('a restarted account with identity and skipped birthday does not loop through setup', async () => {
  jest.mocked(useProfile).mockReturnValue({
    failed: false,
    loading: false,
    username: 'new_person',
    displayName: 'New',
    birthdayRequired: true,
  } as ReturnType<typeof useProfile>);
  let tree: any;
  await act(async () => {
    tree = create(<RootLayout />);
  });
  expect(tree.root.findAllByType('test-protected').map((n: any) => n.props.guard)).toEqual([
    false,
    false,
    false,
    true,
  ]);
  await act(async () => tree.unmount());
});

describe('Friends invitations', () => {
  const session = {
    user: { id: 'recipient', email: 'recipient@example.com' },
    accessToken: 'token',
  };

  function profile(username: string | null, optionalSetupPending = false) {
    jest.mocked(useProfile).mockReturnValue({
      failed: false,
      loading: false,
      username,
      displayName: 'Recipient',
      optionalSetupPending,
    } as ReturnType<typeof useProfile>);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    takePendingFriends();
    mockPathname = redirectSystemPath({ path: 'wtw://friends', initial: true });
  });

  afterEach(() => {
    mockPathname = '/';
    takePendingFriends();
  });

  test('native intent rewrites only the fixed Friends link', () => {
    expect(mockPathname).toBe('/friend-invite');
    expect(redirectSystemPath({ path: 'wtw:///friends', initial: false })).toBe('/friend-invite');
    for (const path of [
      'wtw://friends?requests=1',
      'wtw://friends/elsewhere',
      'wtw://join/ABCD',
      'wtw://i/token',
      'wtw://p/id',
      'wtw://pick/123/lobby',
      'https://example.com/friends',
    ]) {
      expect(redirectSystemPath({ path, initial: false })).toBe(path);
    }
  });

  test('an authorized recipient proceeds straight to Friends and consumes the link once', async () => {
    profile('recipient');
    jest.mocked(useAuth).mockReturnValue({ session, loading: false });
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<RootLayout />);
    });
    expect(router.dismissTo).toHaveBeenCalledTimes(1);
    expect(router.dismissTo).toHaveBeenCalledWith('/friends');
    mockPathname = '/friends';
    await act(async () => tree.update(<RootLayout />));
    expect(router.navigate).not.toHaveBeenCalled();
    expect(takePendingFriends()).toBe(false);
    await act(async () => tree.unmount());
  });

  test('a signed-out recipient resumes Friends after sign-in and first-run setup', async () => {
    jest.mocked(useAuth).mockReturnValue({ session: null, loading: false });
    profile(null);
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<RootLayout />);
    });
    expect(router.replace).toHaveBeenCalledWith('/sign-in');
    expect(router.navigate).not.toHaveBeenCalled();

    jest.mocked(useAuth).mockReturnValue({ session, loading: false });
    mockPathname = '/welcome';
    await act(async () => tree.update(<RootLayout />));
    expect(router.navigate).not.toHaveBeenCalled();

    profile('recipient', true);
    mockPathname = '/';
    await act(async () => tree.update(<RootLayout />));
    expect(router.push).toHaveBeenCalledWith('/onboarding');
    expect(router.navigate).not.toHaveBeenCalled();

    mockPathname = '/onboarding';
    profile('recipient');
    await act(async () => tree.update(<RootLayout />));
    expect(router.navigate).not.toHaveBeenCalled();

    mockPathname = '/';
    await act(async () => tree.update(<RootLayout />));
    expect(router.navigate).toHaveBeenCalledTimes(1);
    expect(router.navigate).toHaveBeenCalledWith('/friends');
    await act(async () => tree.update(<RootLayout />));
    expect(router.navigate).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
  });
});
