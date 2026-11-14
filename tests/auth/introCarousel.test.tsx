import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import IntroScreen from '../../app/intro';
import RootLayout from '../../app/_layout';
import { openLegalPage, PRIVACY_URL, TERMS_URL } from '@/lib/legal';

type Node = { type: unknown; props: Record<string, any>; children: unknown[] };
type Tree = {
  root: {
    findAllByType(type: string): Node[];
    findAll(test: (n: Node) => boolean): Node[];
  };
  unmount(): void;
};
const { create, act } = jest.requireActual<{
  create(element: React.ReactElement): Tree;
  act(work: () => void | Promise<void>): Promise<void>;
}>('react-test-renderer');

let mockSession: { user: { id: string } } | null = null;
jest.mock('@/hooks/useAuth', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({ loading: false, session: mockSession }),
}));
jest.mock('@/hooks/useProfile', () => ({
  ProfileProvider: ({ children }: { children: React.ReactNode }) => children,
  useProfile: () => ({ loading: false, failed: false, displayName: null, username: null }),
}));
jest.mock('@/hooks/useAvatarSource', () => ({ useAvatarLifecycle: jest.fn() }));
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
jest.mock('@/lib/pendingProfile', () => ({ resumePendingProfile: jest.fn() }));
jest.mock('@/lib/pendingJoin', () => ({ takePendingJoin: () => null }));
jest.mock('@/lib/legal', () => ({
  openLegalPage: jest.fn(),
  PRIVACY_URL: 'https://example.test/privacy',
  TERMS_URL: 'https://example.test/terms',
}));
jest.mock('@/components', () => {
  const React = jest.requireActual('react');
  const el = (name: string) =>
    function Mock(props: object) {
      return React.createElement(`test-${name}`, props);
    };
  return {
    ...jest.requireActual('@/components/theme'),
    Screen: ({ children }: { children: React.ReactNode }) => children,
    Button: el('button'),
    ErrorState: el('ErrorState'),
    Illustration: () => null,
    OnboardingCopy: el('copy'),
    PageDots: el('dots'),
    onboardingStyles: { fine: {} },
  };
});
jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  const Stack = Object.assign((props: object) => React.createElement('test-Stack', props), {
    Protected: (props: object) => React.createElement('test-Protected', props),
    Screen: (props: object) => React.createElement('test-Screen', props),
  });
  return { Stack, router: { push: jest.fn(), replace: jest.fn() }, usePathname: () => '/' };
});

async function render(element: React.ReactElement) {
  let tree!: Tree;
  await act(async () => {
    tree = create(element);
  });
  return tree;
}
const button = (tree: Tree, label: string) =>
  tree.root.findAllByType('test-button').find((b) => b.props.label === label)!;
beforeEach(async () => {
  jest.clearAllMocks();
  mockSession = null;
  await AsyncStorage.clear();
});

describe('root layout', () => {
  /** Signed out, Stack.Protected falls back to the first screen whose guard is open. */
  function landing(tree: Tree) {
    const groups = tree.root.findAllByType('test-Protected').filter((g) => g.props.guard);
    const first = groups[0] as unknown as { findAllByType(t: string): Node[] } | undefined;
    return first?.findAllByType('test-Screen')[0]?.props.name;
  }

  test('a new signed-out device lands on the intro; after it is seen, sign-in', async () => {
    const first = await render(<RootLayout />);
    expect(landing(first)).toBe('intro');
    await act(async () => first.unmount());

    const intro = await render(<IntroScreen />);
    await act(async () => button(intro, 'Get started').props.onPress());
    await act(async () => intro.unmount());

    const second = await render(<RootLayout />);
    expect(landing(second)).toBe('sign-in');
    await act(async () => second.unmount());
  });

  test('signing in counts as having seen the intro, so a later sign-out goes to sign-in', async () => {
    mockSession = { user: { id: 'u1' } };
    const tree = await render(<RootLayout />);
    const intro = tree.root
      .findAllByType('test-Protected')
      .find((g) =>
        (g as unknown as { findAllByType(t: string): Node[] })
          .findAllByType('test-Screen')
          .some((s) => s.props.name === 'intro'),
      )!;
    expect(intro.props.guard).toBe(false);
    expect(await AsyncStorage.getItem('wtw.introSeen.v1')).toBe('1');
    await act(async () => tree.unmount());
  });
});

describe('intro carousel', () => {
  test('Get started opens sign-up and Log in opens log-in, replacing the intro', async () => {
    const tree = await render(<IntroScreen />);
    await act(async () => button(tree, 'Get started').props.onPress());
    expect(router.replace).toHaveBeenLastCalledWith({
      pathname: '/sign-in',
      params: { mode: 'signup' },
    });
    await act(async () => button(tree, 'Already have an account? Log in').props.onPress());
    expect(router.replace).toHaveBeenLastCalledWith({
      pathname: '/sign-in',
      params: { mode: 'login' },
    });
    expect(router.push).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  });

  test('three slides with announced page dots, labelled buttons and legal links', async () => {
    const tree = await render(<IntroScreen />);
    expect(tree.root.findAllByType('test-copy').map((c) => c.props.title)).toEqual([
      'Swipe',
      'Decide together',
      'Go',
    ]);
    const dots = tree.root.findAllByType('test-dots')[0]!;
    expect(dots.props).toMatchObject({ index: 0, total: 3 });
    await act(async () => dots.props.onChange(2));
    expect(tree.root.findAllByType('test-dots')[0]!.props.index).toBe(2);
    for (const b of tree.root.findAllByType('test-button'))
      expect(b.props.accessibilityLabel ?? b.props.label).toBeTruthy();
    await act(async () => button(tree, 'Terms').props.onPress());
    expect(openLegalPage).toHaveBeenCalledWith(TERMS_URL, 'Terms of Use');
    await act(async () => button(tree, 'Privacy Policy').props.onPress());
    expect(openLegalPage).toHaveBeenCalledWith(PRIVACY_URL, 'Privacy Policy');
    // Legal links don't count as finishing the intro.
    expect(await AsyncStorage.getItem('wtw.introSeen.v1')).toBeNull();
    await act(async () => tree.unmount());
  });
});
