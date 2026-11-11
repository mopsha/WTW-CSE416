import React from 'react';
import { Keyboard, Modal, Platform } from 'react-native';
import { Sheet } from '@/components/TabUi';
import FriendsScreen from '../../app/(tabs)/friends';
import { api } from '@/lib/api';
import { queries } from '@/lib/queries';
import { router } from 'expo-router';
jest.mock('@/hooks/useAvatarSource', () => ({
  useAvatarSource: () => null,
  useAvatarPhoto: () => ({
    uri: null,
    ref: null,
    displayed: false,
    displayKey: undefined,
    onDisplay: () => {},
  }),
}));
const { create, act } = jest.requireActual('react-test-renderer');
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  router: { push: jest.fn() },
  useFocusEffect: (effect: () => void) => jest.requireActual('react').useEffect(effect, [effect]),
}));
jest.mock('@/hooks/useAuth', () => ({ useSession: () => ({ user: { id: 'me' } }) }));
jest.mock('@/lib/api', () => ({
  api: {
    listFriends: jest.fn(),
    openDirectConversation: jest.fn(),
    acceptFriend: jest.fn(),
    removeFriend: jest.fn(),
    addFriend: jest.fn(),
  },
}));
jest.mock('@/lib/queries', () => ({ queries: { listMyGroups: jest.fn() } }));
jest.mock('@/lib/confirm', () => ({ confirmAction: jest.fn() }));
jest.mock('@/lib/haptics', () => ({ haptic: { success: jest.fn(), tap: jest.fn() } }));
jest.mock('@/lib/config', () => ({ USE_MOCK: false }));
jest.mock('@/components/GroupInvitations', () => ({
  GroupInvitations: ({
    renderContainer,
  }: {
    renderContainer: (state: object) => React.ReactNode;
  }) => renderContainer({ count: 1, loading: false, error: null, content: null }),
}));
jest.mock('@/components', () => ({
  ...jest.requireActual('@/components/theme'),
  Screen: ({ children }: { children: React.ReactNode }) => children,
  Button: (p: object) => jest.requireActual('react').createElement('test-button', p),
  ErrorState: (p: object) => jest.requireActual('react').createElement('test-error', p),
}));

jest.mock('@/components/friends/UsernameFriendSearch', () => ({
  UsernameFriendSearch: (p: object) => jest.requireActual('react').createElement('test-search', p),
}));

const originalOS = Platform.OS;
beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  jest.mocked(api.listFriends).mockResolvedValue({ friends: [], incoming: [] });
  jest.mocked(queries.listMyGroups).mockResolvedValue([]);
});
afterEach(() => {
  Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
  jest.restoreAllMocks();
});
async function mount() {
  let tree: any;
  await act(async () => {
    tree = create(<FriendsScreen />);
  });
  await act(async () =>
    tree.root
      .findAllByProps({ accessibilityLabel: 'Add a friend' })
      .find((n: any) => n.props.onPress)
      .props.onPress(),
  );
  return tree;
}
function sheet(tree: any, title: string) {
  return tree.root.findAllByType(Sheet).find((n: any) => n.props.title === title);
}
test.each(['requests', 'profile'] as const)(
  'iOS %s handoff waits for native dismissal and clears the keyboard',
  async (kind) => {
    const keyboard = jest.spyOn(Keyboard, 'dismiss');
    const tree = await mount();
    await act(async () =>
      tree.root
        .findByType('test-search')
        .props.onNavigate(kind === 'profile' ? { kind, id: 'target' } : { kind }),
    );
    expect(keyboard).toHaveBeenCalled();
    expect(sheet(tree, 'Add a friend').props.visible).toBe(false);
    expect(sheet(tree, 'Requests').props.visible).toBe(false);
    expect(router.push).not.toHaveBeenCalled();
    await act(async () => sheet(tree, 'Add a friend').props.onDismiss());
    if (kind === 'requests') expect(sheet(tree, 'Requests').props.visible).toBe(true);
    else
      expect(router.push).toHaveBeenCalledWith({ pathname: '/p/[id]', params: { id: 'target' } });
    await act(async () => sheet(tree, 'Add a friend').props.onDismiss());
    if (kind === 'profile') expect(router.push).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
  },
);
test('Android handoff follows the committed nonanimated hide without a timer', async () => {
  Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
  const tree = await mount();
  await act(async () =>
    tree.root.findByType('test-search').props.onNavigate({ kind: 'profile', id: 'target' }),
  );
  expect(sheet(tree, 'Add a friend').props.visible).toBe(false);
  expect(router.push).toHaveBeenCalledWith({ pathname: '/p/[id]', params: { id: 'target' } });
  await act(async () => tree.unmount());
});

test.each(['ios', 'android'] as const)(
  '%s Sheet preserves motion overrides together with safe dismissal callbacks',
  async (platform) => {
    Object.defineProperty(Platform, 'OS', { value: platform, configurable: true });
    const dismissed = jest.fn(),
      close = jest.fn();
    let tree: any;
    const render = (visible: boolean, motion: 'none' | 'slide' | 'fade', handoff = true) => (
      <Sheet
        visible={visible}
        title="Combined sheet"
        onClose={close}
        animationType={motion}
        onDismiss={handoff ? dismissed : undefined}
      >
        {null}
      </Sheet>
    );
    await act(async () => {
      tree = create(render(true, 'none'));
    });
    const modal = () => tree.root.findByType(Modal);
    expect(modal().props.animationType).toBe('none');
    await act(async () => tree.update(render(true, 'fade')));
    expect(modal().props.animationType).toBe(platform === 'ios' ? 'fade' : 'none');
    await act(async () => modal().props.onRequestClose());
    expect(close).toHaveBeenCalledTimes(1);
    expect(dismissed).not.toHaveBeenCalled();
    await act(async () => tree.update(render(false, 'fade')));
    if (platform === 'ios') {
      expect(dismissed).not.toHaveBeenCalled();
      await act(async () => modal().props.onDismiss());
    }
    expect(dismissed).toHaveBeenCalledTimes(1);
    await act(async () => tree.update(render(false, 'fade')));
    expect(dismissed).toHaveBeenCalledTimes(1);
    await act(async () => tree.update(render(true, 'fade', false)));
    expect(modal().props.animationType).toBe('fade');
    await act(async () => tree.unmount());
  },
);
