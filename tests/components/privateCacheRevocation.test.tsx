import { GroupInvitations } from '@/components/GroupInvitations';
import React from 'react';
import { AppState } from 'react-native';
import UserProfileScreen from '../../app/users/[id]';
import { GroupIdeas } from '@/components/GroupIdeas';
import { api } from '@/lib/api';
import type { UserProfile } from '@shared/api/userProfiles.ts';
import type { GroupDetail } from '@/lib/groups';
type Node = { props: { onPress(): void } };
type Tree = { root: { findAllByType(t: string): Node[] }; toJSON(): unknown; unmount(): void };
const { create, act } = jest.requireActual<{
  create(e: React.ReactElement): Tree;
  act(work: () => void | Promise<void>): Promise<void>;
}>('react-test-renderer');
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'friend' }),
  useFocusEffect: (effect: () => void) => jest.requireActual('react').useEffect(effect, [effect]),
}));
jest.mock('@/lib/api', () => ({
  api: { getUserProfile: jest.fn(), listGroupIdeas: jest.fn(), listGroupInvitations: jest.fn() },
}));
jest.mock('@/components/PastMoves', () => ({
  PastMoves: () => jest.requireActual('react').createElement('test-memories'),
}));
jest.mock('@/components/MessageFriendButton', () => ({ MessageFriendButton: () => null }));
jest.mock('@/components/UserProfileMetadata', () => ({
  UserProfileMetadata: (p: object) => jest.requireActual('react').createElement('test-metadata', p),
}));
jest.mock('@/components', () => {
  const React = jest.requireActual('react');
  return {
    ...jest.requireActual('@/components/theme'),
    Screen: ({ children }: { children: React.ReactNode }) => children,
    Card: ({ children }: { children: React.ReactNode }) => children,
    Avatar: () => null,
    Button: () => null,
    Chips: () => null,
    ErrorState: (p: object) => React.createElement('test-error', p),
  };
});
jest.mock('@/components/TabUi', () => {
  const React = jest.requireActual('react');
  return {
    SectionHeading: () => null,
    ListRow: (p: object) => React.createElement('test-row', p),
    Sheet: (p: { visible: boolean; children: React.ReactNode }) =>
      p.visible ? React.createElement('test-sheet', p, p.children) : null,
  };
});
beforeEach(() => {
  jest.useFakeTimers();
  AppState.currentState = 'active';
});
afterEach(() => jest.useRealTimers());
test('focused block/unfriend clears already rendered profile metadata and memories', async () => {
  jest.mocked(api.getUserProfile).mockResolvedValue({
    id: 'friend',
    displayName: 'Private friend',
    username: 'friend',
    isOwner: false,
    metadataVisible: true,
  } as UserProfile);
  let tree!: Tree;
  await act(async () => {
    tree = create(<UserProfileScreen />);
  });
  expect(tree.root.findAllByType('test-metadata')).toHaveLength(1);
  jest
    .mocked(api.getUserProfile)
    .mockRejectedValue(Object.assign(new Error('Profile not found'), { status: 404 }));
  await act(async () => {
    jest.advanceTimersByTime(5000);
  });
  expect(tree.root.findAllByType('test-metadata')).toHaveLength(0);
  expect(tree.root.findAllByType('test-memories')).toHaveLength(0);
  expect(JSON.stringify(tree.toJSON())).not.toContain('Private friend');
  await act(async () => tree.unmount());
  jest.clearAllTimers();
});
test('group removal clears Ideas list and open private detail sheet', async () => {
  const group: GroupDetail = {
    id: 'group',
    name: 'Group',
    ownerId: 'me',
    members: [{ userId: 'me', displayName: 'Me', role: 'owner' }],
    picks: [],
  };
  jest.mocked(api.listGroupIdeas).mockResolvedValue({
    ideas: [
      {
        id: 'idea',
        groupId: 'group',
        createdBy: 'me',
        name: 'Private idea',
        category: 'activity',
        description: 'Private description',
        locationText: 'Private home',
        createdAt: '2026-11-03T00:00:00Z',
        updatedAt: '2026-11-03T00:00:00Z',
      },
    ],
  });
  let tree!: Tree;
  await act(async () => {
    tree = create(<GroupIdeas group={group} userId="me" />);
  });
  await act(async () => tree.root.findAllByType('test-row')[0]!.props.onPress());
  expect(tree.root.findAllByType('test-sheet')).toHaveLength(1);
  jest
    .mocked(api.listGroupIdeas)
    .mockRejectedValue(Object.assign(new Error('Not found'), { status: 404 }));
  await act(async () => {
    jest.advanceTimersByTime(5000);
  });
  expect(tree.root.findAllByType('test-row')).toHaveLength(0);
  expect(tree.root.findAllByType('test-sheet')).toHaveLength(0);
  expect(JSON.stringify(tree.toJSON())).not.toContain('Private home');
  await act(async () => tree.unmount());
  jest.clearAllTimers();
});

test('pending invite names disappear after authorization is revoked or a reload fails', async () => {
  jest
    .mocked(api.listGroupInvitations)
    .mockResolvedValue({
      invitations: [
        { id: 'invite', groupName: 'Private invited group', inviterName: 'Friend' },
      ] as Awaited<ReturnType<typeof api.listGroupInvitations>>['invitations'],
    });
  let tree!: Tree;
  await act(async () => {
    tree = create(<GroupInvitations onAccepted={() => {}} refreshing={false} />);
  });
  expect(JSON.stringify(tree.toJSON())).toContain('Private invited group');
  jest.mocked(api.listGroupInvitations).mockRejectedValue(new Error('Unavailable'));
  await act(async () => {
    jest.advanceTimersByTime(5000);
  });
  expect(JSON.stringify(tree.toJSON())).not.toContain('Private invited group');
  await act(async () => tree.unmount());
  jest.clearAllTimers();
});
