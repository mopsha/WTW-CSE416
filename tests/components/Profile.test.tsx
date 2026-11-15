import { UserProfileMetadata } from '@/components/UserProfileMetadata';
import React from 'react';
import { AppState } from 'react-native';
import { useSession } from '@/hooks/useAuth';
import ProfileScreen from '../../app/(tabs)/profile';
import { ProfileHero, ProfileFavorites } from '@/components/profile/ProfilePresentation';
import { api } from '@/lib/api';
import { router } from 'expo-router';
import { accountActions } from '@/lib/accountActions';
import type { UserProfile } from '@shared/api/userProfiles.ts';
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
jest.mock('@/components/ProfilePhotoEditor', () => ({
  ProfilePhotoEditor: (p: object) =>
    jest.requireActual('react').createElement('test-photo-editor', p),
}));
const { create, act } = jest.requireActual('react-test-renderer');
const mockSaveName = jest.fn();
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useFocusEffect: (effect: () => void) => jest.requireActual('react').useEffect(effect, [effect]),
}));
jest.mock('@/hooks/useAuth', () => ({
  useSession: jest.fn(),
}));
jest.mock('@/hooks/useProfile', () => ({
  useProfile: () => ({
    displayName: 'Demo Person',
    preferences: null,
    saveDisplayName: mockSaveName,
  }),
  suggestedName: () => 'Demo',
}));
jest.mock('@/lib/preferences', () => ({ preferencesSummary: () => 'Food and activities' }));
jest.mock('@/lib/api', () => ({
  api: { getMyUserProfile: jest.fn(), updateProfileDetails: jest.fn() },
}));
jest.mock('@/lib/accountActions', () => ({
  accountActions: { logOut: jest.fn(), deleteAccount: jest.fn() },
}));
jest.mock('@/components/PastMoves', () => ({
  PastMoves: (p: object) => jest.requireActual('react').createElement('test-past-moves', p),
}));
jest.mock('@/components', () => ({
  ...jest.requireActual('@/components/theme'),
  Screen: ({ children }: { children: React.ReactNode }) => children,
  Button: (p: object) => jest.requireActual('react').createElement('test-button', p),
  ErrorState: (p: object) => jest.requireActual('react').createElement('test-error', p),
}));
const profile: UserProfile = {
  id: 'me',
  displayName: 'Demo Person',
  username: 'demo_person',
  avatarUrl: null,
  isOwner: true,
  metadataVisible: true,
  shareMetadata: false,
  friendsCount: 3,
  groupsCount: 2,
  favoriteCuisine: 'Japanese',
  favoriteActivity: 'Bowling',
  mutualGroups: [],
};
beforeEach(() => {
  jest.clearAllMocks();
  AppState.currentState = 'active';
  jest
    .mocked(useSession)
    .mockReturnValue({ user: { id: 'me', email: 'demo@example.test' } } as ReturnType<
      typeof useSession
    >);
  jest.mocked(api.getMyUserProfile).mockResolvedValue(profile);
});
async function mount() {
  let tree: any;
  await act(async () => {
    tree = create(<ProfileScreen />);
  });
  return tree;
}
function press(tree: any, label: string) {
  tree.root
    .findAllByProps({ accessibilityLabel: label })
    .find((n: any) => typeof n.props.onPress === 'function')
    .props.onPress();
}
function button(tree: any, label: string) {
  return tree.root.findAllByType('test-button').find((n: any) => n.props.label === label);
}
test('own identity, actual counts and favorites render with unchanged settings routes', async () => {
  const tree = await mount();
  expect(JSON.stringify(tree.toJSON())).toContain('demo_person');
  expect(JSON.stringify(tree.toJSON())).toContain('Japanese');
  expect(JSON.stringify(tree.toJSON())).toContain('3 friends');
  expect(tree.root.findByType('test-past-moves').props).toEqual(
    expect.objectContaining({ userId: 'me', variant: 'profile' }),
  );
  await act(async () => press(tree, 'Preferences'));
  expect(router.push).toHaveBeenLastCalledWith('/preferences');
  await act(async () => press(tree, 'Notifications'));
  expect(router.push).toHaveBeenLastCalledWith({
    pathname: '/settings',
    params: { section: 'notifications' },
  });
  await act(async () => press(tree, 'Settings'));
  expect(router.push).toHaveBeenLastCalledWith('/settings');
  await act(async () => tree.unmount());
});
test('Edit profile opens the unified page without a nested editor', async () => {
  const tree = await mount();
  await act(async () => press(tree, 'Edit profile for Demo Person'));
  expect(router.push).toHaveBeenLastCalledWith('/settings/profile');
  expect(button(tree, 'Profile details & privacy')).toBeUndefined();
  expect(JSON.stringify(tree.toJSON())).not.toContain('Your name');
  await act(async () => tree.unmount());
});
test('account actions remain accessible and go through accountActions', async () => {
  const tree = await mount();
  await act(async () => press(tree, 'Sign out'));
  expect(accountActions.logOut).toHaveBeenCalledTimes(1);
  await act(async () => press(tree, 'Delete account'));
  expect(accountActions.deleteAccount).toHaveBeenCalledTimes(1);
  await act(async () => tree.unmount());
});
test('details failure supports retry; absent details never fabricate social counts', async () => {
  jest.mocked(api.getMyUserProfile).mockRejectedValueOnce(new Error('Offline'));
  const tree = await mount();
  expect(tree.root.findByType('test-error').props.message).toBe('Offline');
  expect(JSON.stringify(tree.toJSON())).not.toContain('3 friends');
  await act(async () => tree.root.findByType('test-error').props.onRetry());
  expect(JSON.stringify(tree.toJSON())).toContain('3 friends');
  await act(async () => tree.unmount());
});
test('hidden metadata and absent favorites do not leak details or add fake placeholders', async () => {
  const tree = await mount();
  let hero: any;
  await act(async () => {
    hero = create(<ProfileHero name="Demo" profile={{ ...profile, metadataVisible: false }} />);
  });
  expect(JSON.stringify(hero.toJSON())).not.toContain('3 friends');
  await act(async () => {
    tree.unmount();
    hero.unmount();
  });
});

test('loading and empty metadata states show no invented identity details', async () => {
  let resolve!: (p: UserProfile) => void;
  jest.mocked(api.getMyUserProfile).mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const tree = await mount();
  expect(JSON.stringify(tree.toJSON())).toContain('Loading profile details');
  expect(JSON.stringify(tree.toJSON())).not.toContain('3 friends');
  await act(async () =>
    resolve({
      ...profile,
      favoriteCuisine: null,
      favoriteActivity: null,
      friendsCount: 0,
      groupsCount: 0,
    }),
  );
  expect(JSON.stringify(tree.toJSON())).toContain('0 friends');
  expect(JSON.stringify(tree.toJSON())).not.toContain('Japanese');
  let favorites: any;
  await act(async () => {
    favorites = create(<ProfileFavorites profile={{ ...profile, metadataVisible: false }} />);
  });
  expect(JSON.stringify(favorites.toJSON())).toContain('Profile details are private.');
  expect(JSON.stringify(favorites.toJSON())).not.toContain('Japanese');
  await act(async () => {
    tree.unmount();
    favorites.unmount();
  });
});

test('friend birthday renders as month/day independently from metadata privacy, with no birth year', async () => {
  let tree: any;
  await act(async () => {
    tree = create(
      <UserProfileMetadata
        profile={{
          ...profile,
          isOwner: false,
          metadataVisible: false,
          birthday: { month: 2, day: 29 },
        }}
      />,
    );
  });
  expect(JSON.stringify(tree.toJSON())).toContain('February 29');
  expect(JSON.stringify(tree.toJSON())).not.toMatch(/2000|birthDate|January/);
  await act(async () => tree.unmount());
});

test('account switch immediately removes private details and ignores a late previous-account response', async () => {
  const tree = await mount();
  let resolve!: (p: UserProfile) => void;
  jest.mocked(api.getMyUserProfile).mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  jest
    .mocked(useSession)
    .mockReturnValue({ user: { id: 'other', email: 'other@example.test' } } as ReturnType<
      typeof useSession
    >);
  await act(async () => tree.update(<ProfileScreen />));
  expect(
    tree.root.findAllByProps({ accessibilityLabel: 'Loading profile details' }).length,
  ).toBeGreaterThan(0);
  expect(tree.root.findAllByType(ProfileFavorites)).toHaveLength(0);
  // A mismatched API response is also rejected, even after the keyed owner changed.
  await act(async () => resolve(profile));
  expect(tree.root.findAllByType(ProfileFavorites)).toHaveLength(0);
  expect(tree.root.findByType('test-error').props.message).toContain('verify profile');
  await act(async () => tree.unmount());
});

test('same-focus refresh retains authorized details through transient errors and clears them on denial', async () => {
  jest.useFakeTimers();
  const tree = await mount();
  try {
    jest.mocked(api.getMyUserProfile).mockRejectedValueOnce(new Error('Offline'));
    await act(async () => jest.advanceTimersByTime(5000));
    expect(tree.root.findAllByType(ProfileFavorites)).toHaveLength(1);
    expect(
      tree.root.findAllByProps({ accessibilityLabel: 'Loading profile details' }),
    ).toHaveLength(0);
    jest
      .mocked(api.getMyUserProfile)
      .mockRejectedValueOnce(Object.assign(new Error('Denied'), { status: 403 }));
    await act(async () => jest.advanceTimersByTime(5000));
    expect(tree.root.findAllByType(ProfileFavorites)).toHaveLength(0);
    expect(tree.root.findByType('test-error').props.message).toBe('Denied');
  } finally {
    await act(async () => tree.unmount());
    jest.useRealTimers();
  }
});
