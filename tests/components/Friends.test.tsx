import React from 'react';
import FriendsScreen from '../../app/(tabs)/friends';
import { api } from '@/lib/api';
import { queries } from '@/lib/queries';
import { router } from 'expo-router';
import { confirmAction } from '@/lib/confirm';
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
const friend = { userId: 'ava', displayName: 'Ava', since: '2026-01-01T12:00:00Z' };
const request = { ...friend, userId: 'ben', displayName: 'Ben' };
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(api.listFriends).mockResolvedValue({ friends: [friend], incoming: [request] });
  jest
    .mocked(queries.listMyGroups)
    .mockResolvedValue([
      { id: 'crew', name: 'Our crew', memberCount: 3, ownerId: 'me', isOwner: true },
    ]);
});
async function mount() {
  let tree: any;
  await act(async () => {
    tree = create(<FriendsScreen />);
  });
  return tree;
}
function press(tree: any, label: string) {
  return tree.root
    .findAllByProps({ accessibilityLabel: label })
    .find((n: any) => typeof n.props.onPress === 'function')
    .props.onPress();
}
function button(tree: any, label: string) {
  return tree.root.findAllByType('test-button').find((n: any) => n.props.label === label);
}
test('profile and explicit message targets stay separate; duplicate sends are guarded', async () => {
  const tree = await mount();
  expect(api.openDirectConversation).not.toHaveBeenCalled();
  const profile = tree.root.findAll(
    (n: any) =>
      n.props.accessibilityRole === 'button' &&
      n.props.accessibilityLabel?.startsWith('Ava, Friends since') &&
      typeof n.props.onPress === 'function',
  )[0];
  await act(async () => profile.props.onPress());
  expect(router.push).toHaveBeenLastCalledWith({ pathname: '/users/[id]', params: { id: 'ava' } });
  let resolve!: (value: any) => void;
  jest.mocked(api.openDirectConversation).mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  await act(async () => {
    press(tree, 'Message Ava');
    press(tree, 'Message Ava');
  });
  expect(api.openDirectConversation).toHaveBeenCalledTimes(1);
  await act(async () => resolve({ id: 'conversation' }));
  expect(router.push).toHaveBeenLastCalledWith({
    pathname: '/messages/[id]',
    params: { id: 'conversation' },
  });
  await act(async () => tree.unmount());
});
test('requests and removal retain explicit confirmation and existing API operations', async () => {
  const tree = await mount();
  expect(JSON.stringify(tree.toJSON())).not.toContain('Request sent by email');
  await act(async () => press(tree, 'Requests, 2 pending'));
  await act(async () => press(tree, "Accept Ben's friend request"));
  expect(api.acceptFriend).toHaveBeenCalledWith('ben');
  await act(async () => press(tree, "Decline Ben's friend request"));
  expect(api.removeFriend).toHaveBeenCalledWith('ben');
  await act(async () => press(tree, 'Close Requests'));
  jest.mocked(confirmAction).mockResolvedValue(false);
  await act(async () => press(tree, 'Remove Ava from friends'));
  expect(api.removeFriend).not.toHaveBeenCalledWith('ava');
  jest.mocked(confirmAction).mockResolvedValue(true);
  await act(async () => press(tree, 'Remove Ava from friends'));
  expect(api.removeFriend).toHaveBeenCalledWith('ava');
  await act(async () => tree.unmount());
});
test('groups reuse loaded data and retain navigation, Start, and management actions', async () => {
  const tree = await mount();
  await act(async () => press(tree, 'Groups'));
  expect(queries.listMyGroups).toHaveBeenCalledTimes(1);
  await act(async () => press(tree, 'Our crew, 3 people'));
  expect(router.push).toHaveBeenLastCalledWith({
    pathname: '/groups/[id]',
    params: { id: 'crew' },
  });
  await act(async () => press(tree, 'Start a Pick with Our crew'));
  expect(router.push).toHaveBeenLastCalledWith(expect.objectContaining({ pathname: '/pick/new' }));
  await act(async () => button(tree, 'Create a group').props.onPress());
  expect(router.push).toHaveBeenLastCalledWith('/groups');
  await act(async () => tree.unmount());
});
test('empty and failed lists remain actionable without placeholder conversations', async () => {
  jest.mocked(api.listFriends).mockRejectedValueOnce(new Error('Offline'));
  const tree = await mount();
  expect(tree.root.findByType('test-error').props.message).toBe('Offline');
  jest.mocked(api.listFriends).mockResolvedValue({ friends: [], incoming: [] });
  await act(async () => tree.root.findByType('test-error').props.onRetry());
  expect(JSON.stringify(tree.toJSON())).toContain('No friends here yet');
  jest.mocked(queries.listMyGroups).mockResolvedValue([]);
  await act(async () => press(tree, 'Add a friend'));
  expect(JSON.stringify(tree.toJSON())).toContain("Friend's username");
  expect(api.openDirectConversation).not.toHaveBeenCalled();
  await act(async () => tree.unmount());
});

test('loading resolves into intentional empty states for both segments', async () => {
  let resolve!: (value: any) => void;
  jest.mocked(api.listFriends).mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  jest.mocked(queries.listMyGroups).mockResolvedValue([]);
  const tree = await mount();
  expect(JSON.stringify(tree.toJSON())).toContain('Loading your friends');
  await act(async () => resolve({ friends: [], incoming: [] }));
  expect(JSON.stringify(tree.toJSON())).toContain('No friends here yet');
  await act(async () => press(tree, 'Groups'));
  expect(JSON.stringify(tree.toJSON())).toContain('Your crew goes here');
  expect(button(tree, 'Create a group')).toBeDefined();
  await act(async () => tree.unmount());
});
