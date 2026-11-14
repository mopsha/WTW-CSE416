import { useAvatarPhoto } from '@/hooks/useAvatarSource';
import React from 'react';
import GroupScreen from '../../app/groups/[id]/details';
import UserScreen from '../../app/users/[id]';
import { queries } from '@/lib/queries';
import { api } from '@/lib/api';
jest.mock('@/hooks/useAvatarSource', () => ({
  useAvatarPhoto: jest.fn(() => ({
    displayKey: undefined,
    displayed: false,
    onDisplay: () => {},
    uri: null,
    ref: null,
  })),
}));
const { create, act } = jest.requireActual('react-test-renderer');
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), setParams: jest.fn() },
  Stack: { Screen: () => null },
  useFocusEffect: (effect: () => void) => jest.requireActual('react').useEffect(effect, [effect]),
  useLocalSearchParams: () => ({ id: 'fixture', section: 'members' }),
}));
jest.mock('@/hooks/useAuth', () => ({
  useSession: () => ({ user: { id: 'me' } }),
  useAuth: () => ({ session: { user: { id: 'me' } } }),
}));
jest.mock('@/hooks/usePrivateRefresh', () => ({
  usePrivateRefresh: (load: () => Promise<void>) =>
    jest.requireActual('react').useEffect(() => {
      void load();
    }, [load]),
}));
jest.mock('@/lib/queries', () => ({
  queries: { getGroup: jest.fn(), listMyFriends: jest.fn().mockResolvedValue([]) },
}));
jest.mock('@/lib/api', () => ({ api: { getUserProfile: jest.fn() } }));
jest.mock('@/components/MemberMenu', () => ({
  MemberMenu: (p: object) => jest.requireActual('react').createElement('test-member-menu', p),
}));
jest.mock('@/components/GroupChat', () => ({ GroupChat: () => null }));
jest.mock('@/components/GroupIdeas', () => ({ GroupIdeas: () => null }));
jest.mock('@/components/PastMoves', () => ({ PastMoves: () => null }));
jest.mock('@/components/MessageFriendButton', () => ({ MessageFriendButton: () => null }));
jest.mock('@/components/UserProfileMetadata', () => ({ UserProfileMetadata: () => null }));
jest.mock('@/components', () => ({
  ...jest.requireActual('@/components/theme'),
  Screen: ({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) => (
    <>
      {right}
      {children}
    </>
  ),
  Card: ({ children }: { children: React.ReactNode }) => children,
  Avatar: () => null,
  IconButton: () => null,
  Button: () => null,
  EmptyState: () => null,
  ErrorState: () => null,
}));
beforeEach(() =>
  jest.mocked(useAvatarPhoto).mockReturnValue({
    displayKey: undefined,
    displayed: false,
    onDisplay: () => {},
    uri: null,
    ref: null,
  }),
);
test('group member safety menus exclude self and refresh group access after blocking', async () => {
  jest.mocked(queries.getGroup).mockResolvedValue({
    id: 'fixture',
    name: 'Friends',
    ownerId: 'ava',
    picks: [],
    members: [
      { userId: 'me', displayName: 'Me', role: 'member' },
      { userId: 'ava', displayName: 'Ava', role: 'owner' },
    ],
  });
  let tree: any;
  await act(async () => {
    tree = create(<GroupScreen />);
  });
  const menus = tree.root.findAllByType('test-member-menu');
  expect(menus).toHaveLength(1);
  expect(menus[0].props.userId).toBe('ava');
  await act(async () => menus[0].props.onBlocked());
  expect(queries.getGroup).toHaveBeenCalledTimes(2);
  await act(async () => tree.unmount());
});
test.each([false, true])('profile safety menu respects ownership (owner=%s)', async (isOwner) => {
  jest.mocked(api.getUserProfile).mockResolvedValue({
    id: isOwner ? 'me' : 'ava',
    displayName: 'Ava',
    username: 'ava',
    avatarUrl: null,
    isOwner,
    metadataVisible: false,
  } as Awaited<ReturnType<typeof api.getUserProfile>>);
  let tree: any;
  await act(async () => {
    tree = create(<UserScreen />);
  });
  const menus = tree.root.findAllByType('test-member-menu');
  expect(menus).toHaveLength(isOwner ? 0 : 1);
  if (!isOwner) {
    expect(menus[0].props.userId).toBe('ava');
    const calls = jest.mocked(api.getUserProfile).mock.calls.length;
    await act(async () => menus[0].props.onBlocked());
    expect(api.getUserProfile).toHaveBeenCalledTimes(calls + 1);
  }
  await act(async () => tree.unmount());
});

test('profile forwards only the currently rendered authorized photo to the existing menu', async () => {
  jest.mocked(api.getUserProfile).mockResolvedValue({
    id: 'ava',
    displayName: 'Ava',
    username: 'ava',
    avatarUrl: null,
    avatarRef: null,
    isOwner: false,
    metadataVisible: false,
  } as Awaited<ReturnType<typeof api.getUserProfile>>);
  jest.mocked(useAvatarPhoto).mockReturnValue({
    displayKey: undefined,
    displayed: true,
    onDisplay: () => {},
    uri: 'data:image/jpeg;base64,photo',
    ref: { userId: 'ava', revision: 7 },
  });
  let tree: any;
  await act(async () => {
    tree = create(<UserScreen />);
  });
  expect(tree.root.findByType('test-member-menu').props.photo).toEqual({
    userId: 'ava',
    revision: 7,
  });
  jest.mocked(useAvatarPhoto).mockReturnValue({
    displayKey: undefined,
    displayed: false,
    onDisplay: () => {},
    uri: null,
    ref: null,
  });
  await act(async () => tree.update(<UserScreen />));
  expect(tree.root.findByType('test-member-menu').props.photo).toBeUndefined();
  await act(async () => tree.unmount());
});
