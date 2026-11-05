import React from 'react';
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
  useSession: () => ({ user: { id: 'me', email: 'demo@example.test' } }),
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
test('existing name editor validates and saves the display name', async () => {
  const tree = await mount();
  await act(async () => press(tree, 'Edit profile for Demo Person'));
  const input = tree.root
    .findAllByProps({ accessibilityLabel: 'Your name' })
    .find((n: any) => typeof n.props.onChangeText === 'function');
  await act(async () => input.props.onChangeText('  Updated Name  '));
  await act(async () => button(tree, 'Save').props.onPress());
  expect(mockSaveName).toHaveBeenCalledWith('Updated Name');
  await act(async () => tree.unmount());
});
test('details editor preserves the private-sharing default and updates the existing contract', async () => {
  const tree = await mount();
  expect(JSON.stringify(tree.toJSON())).not.toContain('demo@example.test');
  await act(async () => button(tree, 'Profile details & privacy').props.onPress());
  expect(JSON.stringify(tree.toJSON())).toContain('demo@example.test');
  const toggle = tree.root
    .findAllByProps({ accessibilityLabel: 'Share profile metadata with friends' })
    .find((n: any) => typeof n.props.onValueChange === 'function');
  expect(toggle.props.value).toBe(false);
  jest.mocked(api.updateProfileDetails).mockResolvedValue({ ...profile, shareMetadata: true });
  await act(async () => toggle.props.onValueChange(true));
  await act(async () => button(tree, 'Save profile details').props.onPress());
  expect(api.updateProfileDetails).toHaveBeenCalledWith({
    username: 'demo_person',
    favoriteCuisine: 'Japanese',
    favoriteActivity: 'Bowling',
    shareMetadata: true,
  });
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
