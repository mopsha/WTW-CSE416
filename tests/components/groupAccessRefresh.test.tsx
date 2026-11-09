import React from 'react';
import { AppState, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { router } from 'expo-router';
import { haptic } from '@/lib/haptics';
import { space } from '@/components/theme';
import type { GroupDetail } from '@/lib/groups';
import GroupScreen from '../../app/groups/[id]';
import { api } from '@/lib/api';
import { queries } from '@/lib/queries';
type Node = {
  props: {
    onRefresh(): void | Promise<void>;
    onChange(value: string): void;
    onPress(): void;
    label?: string;
    style?: StyleProp<ViewStyle>;
    contentStyle?: ViewStyle;
  };
  parent: Node | null;
};
type Tree = {
  root: { findAllByType(t: string): Node[] };
  toJSON(): unknown;
  unmount(): void;
};
const { create, act } = jest.requireActual<{
  create(e: React.ReactElement): Tree;
  act(work: () => void | Promise<void>): Promise<void>;
}>('react-test-renderer');
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), setParams: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: 'group' }),
  useFocusEffect: (effect: () => void) => jest.requireActual('react').useEffect(effect, [effect]),
}));
jest.mock('@/hooks/useAuth', () => ({ useSession: () => ({ user: { id: 'me' } }) }));
jest.mock('@/lib/api', () => ({ api: { listPendingGroupInvitations: jest.fn() } }));
jest.mock('@/lib/queries', () => ({ queries: { getGroup: jest.fn(), listMyFriends: jest.fn() } }));
jest.mock('@/lib/haptics', () => ({ haptic: { tap: jest.fn(), success: jest.fn() } }));
jest.mock('@/components/GroupChat', () => ({
  GroupChat: (p: object) => jest.requireActual('react').createElement('test-chat', p),
}));
jest.mock('@/components/GroupIdeas', () => ({ GroupIdeas: () => null }));
jest.mock('@/components/TabUi', () => ({
  Segments: (p: object) => jest.requireActual('react').createElement('test-segments', p),
}));
jest.mock('@/components', () => {
  const React = jest.requireActual('react');
  return {
    ...jest.requireActual('@/components/theme'),
    Screen: (p: { children: React.ReactNode }) => React.createElement('test-screen', p, p.children),
    Card: ({ children }: { children: React.ReactNode }) => children,
    Button: (p: object) => React.createElement('test-button', p),
    Avatar: () => null,
    IconButton: () => null,
    EmptyState: (p: object) => React.createElement('test-empty', p),
    ErrorState: (p: object) => React.createElement('test-error', p),
  };
});
beforeEach(() => jest.clearAllMocks());
test('group permission polls avoid redundant friend reads; manual refresh reloads invitations; removal clears the whole page', async () => {
  jest.useFakeTimers();
  AppState.currentState = 'active';
  jest.mocked(queries.getGroup).mockResolvedValue({
    id: 'group',
    name: 'Private group',
    ownerId: 'me',
    members: [{ userId: 'me', displayName: 'Me', role: 'owner' }],
    picks: [],
  });
  jest.mocked(queries.listMyFriends).mockResolvedValue([]);
  jest.mocked(api.listPendingGroupInvitations).mockResolvedValue({ invitations: [] });
  let tree!: Tree;
  await act(async () => {
    tree = create(<GroupScreen />);
  });
  expect(queries.listMyFriends).toHaveBeenCalledTimes(1);
  expect(tree.root.findAllByType('test-chat')).toHaveLength(1);
  expect(tree.root.findAllByType('test-screen')[0]!.props.contentStyle?.padding).toBe(0);
  let inset = tree.root.findAllByType('test-segments')[0]!.parent;
  while (inset && StyleSheet.flatten(inset.props.style)?.marginHorizontal === undefined)
    inset = inset.parent;
  expect(StyleSheet.flatten(inset!.props.style)?.marginHorizontal).toBe(space.lg);
  await act(async () => tree.root.findAllByType('test-segments')[0]!.props.onChange('plans'));
  await act(async () =>
    tree.root
      .findAllByType('test-button')
      .find((node) => node.props.label === 'Start a Pick')!
      .props.onPress(),
  );
  expect(router.push).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/pick/new' }));
  expect(haptic.tap).not.toHaveBeenCalled(); // Button owns this tap, not its callback.
  await act(async () => tree.root.findAllByType('test-segments')[0]!.props.onChange('chat'));
  await act(async () => {
    jest.advanceTimersByTime(5000);
  });
  expect(queries.listMyFriends).toHaveBeenCalledTimes(1);
  await act(async () => tree.root.findAllByType('test-screen')[0]!.props.onRefresh());
  expect(queries.listMyFriends).toHaveBeenCalledTimes(2);
  expect(api.listPendingGroupInvitations).toHaveBeenCalledTimes(2);
  jest.mocked(queries.getGroup).mockResolvedValue(null);
  await act(async () => {
    jest.advanceTimersByTime(5000);
  });
  expect(tree.root.findAllByType('test-chat')).toHaveLength(0);
  expect(JSON.stringify(tree.toJSON())).not.toContain('Private group');
  await act(async () => tree.unmount());
  jest.clearAllTimers();
  jest.useRealTimers();
});
test('group chat auxiliary refresh returns the complete permission/invitation request', async () => {
  const group: GroupDetail = {
    id: 'group',
    name: 'Private group',
    ownerId: 'me',
    members: [{ userId: 'me', displayName: 'Me', role: 'owner' }],
    picks: [],
  };
  jest.mocked(queries.getGroup).mockResolvedValue(group);
  jest.mocked(queries.listMyFriends).mockResolvedValue([]);
  jest.mocked(api.listPendingGroupInvitations).mockResolvedValue({ invitations: [] });
  let tree!: Tree;
  await act(async () => {
    tree = create(<GroupScreen />);
  });
  let finish!: (value: GroupDetail) => void;
  jest.mocked(queries.getGroup).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  let settled = false;
  let refresh!: void | Promise<void>;
  await act(async () => {
    refresh = tree.root.findAllByType('test-chat')[0]!.props.onRefresh();
    void Promise.resolve(refresh).then(() => {
      settled = true;
    });
  });
  expect(settled).toBe(false);
  await act(async () => finish(group));
  await refresh;
  expect(settled).toBe(true);
  expect(api.listPendingGroupInvitations).toHaveBeenCalledTimes(2);
  await act(async () => tree.unmount());
});
