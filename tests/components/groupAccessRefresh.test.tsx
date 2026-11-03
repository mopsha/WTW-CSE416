import React from 'react';
import { AppState } from 'react-native';
import GroupScreen from '../../app/groups/[id]';
import { api } from '@/lib/api';
import { queries } from '@/lib/queries';
type Tree = {
  root: { findAllByType(t: string): { props: { onRefresh(): void } }[] };
  toJSON(): unknown;
  unmount(): void;
};
const { create, act } = jest.requireActual<{
  create(e: React.ReactElement): Tree;
  act(work: () => void | Promise<void>): Promise<void>;
}>('react-test-renderer');
jest.mock('expo-router', () => ({
  router: {},
  useLocalSearchParams: () => ({ id: 'group' }),
  useFocusEffect: (effect: () => void) => jest.requireActual('react').useEffect(effect, [effect]),
}));
jest.mock('@/hooks/useAuth', () => ({ useSession: () => ({ user: { id: 'me' } }) }));
jest.mock('@/lib/api', () => ({ api: { listPendingGroupInvitations: jest.fn() } }));
jest.mock('@/lib/queries', () => ({ queries: { getGroup: jest.fn(), listMyFriends: jest.fn() } }));
jest.mock('@/components/GroupChat', () => ({
  GroupChat: () => jest.requireActual('react').createElement('test-chat'),
}));
jest.mock('@/components/GroupIdeas', () => ({ GroupIdeas: () => null }));
jest.mock('@/components/TabUi', () => ({ Segments: () => null }));
jest.mock('@/components', () => {
  const React = jest.requireActual('react');
  return {
    ...jest.requireActual('@/components/theme'),
    Screen: (p: { children: React.ReactNode }) => React.createElement('test-screen', p, p.children),
    Card: ({ children }: { children: React.ReactNode }) => children,
    Button: () => null,
    Avatar: () => null,
    EmptyState: (p: object) => React.createElement('test-empty', p),
    ErrorState: (p: object) => React.createElement('test-error', p),
  };
});
test('group permission polls avoid redundant friend reads; manual refresh reloads invitations; removal clears the whole page', async () => {
  jest.useFakeTimers();
  AppState.currentState = 'active';
  jest
    .mocked(queries.getGroup)
    .mockResolvedValue({
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
