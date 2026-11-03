import React from 'react';
import RootLayout from '../../app/_layout';
import { useProfile } from '@/hooks/useProfile';

const { create, act } = jest.requireActual('react-test-renderer');
jest.mock('@/hooks/useAuth', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({ loading: false, session: { user: { id: 'returning' } } }),
}));
jest.mock('@/hooks/useProfile', () => ({
  ProfileProvider: ({ children }: { children: React.ReactNode }) => children,
  useProfile: jest.fn(),
}));
jest.mock('react-native-gesture-handler', () => ({
  GestureHandlerRootView: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@expo-google-fonts/poppins', () => ({ useFonts: () => [true, null] }));
jest.mock('expo-splash-screen', () => ({ preventAutoHideAsync: jest.fn(), hideAsync: jest.fn() }));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('@/lib/notify', () => ({
  configureNotifications: jest.fn(),
  onNotificationTap: jest.fn(),
}));
jest.mock('@/lib/push', () => ({ registerForPush: jest.fn() }));
jest.mock('@/lib/auth', () => ({ auth: { signOut: jest.fn() } }));
jest.mock('@/lib/pendingInvite', () => ({ takePendingInvite: async () => null }));
jest.mock('@/lib/pendingJoin', () => ({ takePendingJoin: () => null }));
jest.mock('@/components', () => {
  const React = jest.requireActual('react');
  return Object.fromEntries(
    ['Screen', 'ErrorState', 'Button'].map((name) => [
      name,
      (props: object) => React.createElement(`test-${name}`, props),
    ]),
  );
});
jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  const Stack = Object.assign((props: object) => React.createElement('test-Stack', props), {
    Protected: (props: object) => React.createElement('test-Protected', props),
    Screen: () => null,
  });
  return { Stack, router: { push: jest.fn() }, usePathname: () => '/pick/deep-link/swipe' };
});
test('failed /me does not mount a navigator or redirect a restored deep link into identity setup', async () => {
  const retry = jest.fn();
  jest.mocked(useProfile).mockReturnValue({
    failed: true,
    loading: false,
    retry,
    username: null,
    displayName: null,
  } as unknown as ReturnType<typeof useProfile>);
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(<RootLayout />);
  });
  expect(tree.root.findAllByType('test-Stack')).toHaveLength(0);
  expect(tree.root.findByType('test-Screen').props.title).toBe('Could not load your profile');
  await act(async () => tree.root.findByType('test-ErrorState').props.onRetry());
  expect(retry).toHaveBeenCalledTimes(1);
  jest
    .mocked(useProfile)
    .mockReturnValue({
      failed: false,
      loading: true,
      username: null,
      displayName: null,
    } as ReturnType<typeof useProfile>);
  await act(async () => tree.update(<RootLayout />));
  expect(tree.root.findAllByType('test-Stack')).toHaveLength(0);
  expect(tree.root.findByType('test-Screen').props.title).toBe('Loading your profile…');

  jest.mocked(useProfile).mockReturnValue({
    failed: false,
    loading: false,
    username: 'returning',
    displayName: 'Returning',
  } as ReturnType<typeof useProfile>);
  await act(async () => tree.update(<RootLayout />));
  expect(
    tree.root
      .findAllByType('test-Protected')
      .map((n: { props: { guard: boolean } }) => n.props.guard),
  ).toEqual([false, false, true]);
  jest.mocked(useProfile).mockReturnValue({
    failed: false,
    loading: false,
    username: null,
    displayName: null,
  } as ReturnType<typeof useProfile>);
  await act(async () => tree.update(<RootLayout />));
  expect(
    tree.root
      .findAllByType('test-Protected')
      .map((n: { props: { guard: boolean } }) => n.props.guard),
  ).toEqual([false, true, false]);
  await act(async () => tree.unmount());
});
