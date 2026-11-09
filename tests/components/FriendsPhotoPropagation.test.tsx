import React from 'react';
import { Image } from 'react-native';
import FriendsScreen from '../../app/(tabs)/friends';
import { avatarCache, useAvatarLifecycle } from '@/hooks/useAvatarSource';
import { api } from '@/lib/api';
const { create, act } = jest.requireActual('react-test-renderer');
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  router: { push: jest.fn() },
  useFocusEffect: (fn: () => void) => jest.requireActual('react').useEffect(fn, [fn]),
}));
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ session: { user: { id: 'viewer', email: 'viewer@example.com' } } }),
  useSession: () => ({ user: { id: 'viewer' } }),
}));
jest.mock('@/lib/api', () => ({
  api: {
    listFriends: jest.fn(),
    getAvatar: jest.fn(),
    resolveAvatarRefs: jest.fn(),
  },
}));
jest.mock('@/lib/queries', () => ({ queries: { listMyGroups: jest.fn(async () => []) } }));
jest.mock('@/lib/haptics', () => ({
  haptic: { tap: jest.fn(), success: jest.fn(), error: jest.fn() },
}));
jest.mock('@/components/GroupInvitations', () => ({ GroupInvitations: () => null }));
jest.mock('@/components/GradientButton', () => ({ GradientButton: () => null }));
jest.mock('@/components', () => ({
  ...jest.requireActual('@/components/theme'),
  Avatar: jest.requireActual('@/components/Avatar').Avatar,
  Screen: ({ children }: { children: React.ReactNode }) => children,
  Button: () => null,
  Card: ({ children }: { children: React.ReactNode }) => children,
  ErrorState: () => null,
}));
jest.mock('@/components/TabUi', () => ({
  ListRow: ({ leading }: { leading: React.ReactNode }) => leading,
  HeaderAction: () => null,
  QuietEmpty: () => null,
  SectionHeading: () => null,
  Segments: () => null,
  Sheet: () => null,
  TabHeading: () => null,
}));
function Harness() {
  useAvatarLifecycle('viewer', '/friends', 'viewer@example.com');
  return <FriendsScreen />;
}
test('a mounted Friends row discovers a first photo and hides it when authorization is revoked', async () => {
  avatarCache.setViewer(null);
  avatarCache.setActive(true);
  jest.mocked(api.listFriends).mockResolvedValue({
    friends: [{ userId: 'friend', displayName: 'Ava', avatarRef: null, since: '2026-01-01' }],
    incoming: [],
  });
  jest
    .mocked(api.resolveAvatarRefs)
    .mockResolvedValue({ friend: { revision: 0, avatarRef: null } });
  jest.mocked(api.getAvatar).mockResolvedValue('data:image/jpeg;base64,/9j/2Q==');
  let tree: any;
  await act(async () => {
    tree = create(<Harness />);
  });
  try {
    expect(tree.root.findAllByType(Image)).toHaveLength(0);
    expect(api.getAvatar).not.toHaveBeenCalled();
    const ref = { userId: 'friend', revision: 1 };
    jest
      .mocked(api.resolveAvatarRefs)
      .mockResolvedValue({ friend: { revision: 1, avatarRef: ref } });
    await act(async () => {
      await avatarCache.revalidate();
    });
    expect(tree.root.findAllByType(Image)).toHaveLength(1);
    expect(api.listFriends).toHaveBeenCalledTimes(1);
    expect(api.resolveAvatarRefs).toHaveBeenCalledWith('viewer', ['friend'], expect.anything());
    // The existing resolver omits blocked/unauthorized identities.
    jest.mocked(api.resolveAvatarRefs).mockResolvedValue({});
    await act(async () => {
      await avatarCache.revalidate();
    });
    expect(tree.root.findAllByType(Image)).toHaveLength(0);
    expect(api.getAvatar).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => tree.unmount());
  }
});
