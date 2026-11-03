import React from 'react';
import RootLayout from '../../app/_layout';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
type Node = { props: { guard?: boolean }; findAllByProps(p: object): Node[] };
const { create, act } = jest.requireActual<{
  create(e: React.ReactElement): { root: { findAllByType(t: string): Node[] }; unmount(): void };
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
  return { Stack, router: { push: jest.fn() }, usePathname: () => '/' };
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
