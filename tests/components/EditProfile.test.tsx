import React from 'react';
import EditProfileSettings from '../../app/settings/profile';
import { api } from '@/lib/api';
import { pickProfilePhoto } from '@/lib/pickProfilePhoto';
import type { UserProfile } from '@shared/api/userProfiles.ts';
import { Alert, Platform } from 'react-native';
import { router } from 'expo-router';
const { create, act } = jest.requireActual('react-test-renderer');
let mockSession = { user: { id: 'me', email: 'me@example.test' } };
let mockUploads = false;
let mockSection: string | undefined;
let mockPrevent: { enabled: boolean; callback: (event: { data: { action: object } }) => void };
const mockName = jest.fn();
const mockDispatch = jest.fn();
jest.mock('expo-router', () => ({
  router: { canGoBack: () => true, back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ section: mockSection }),
  useNavigation: () => ({ dispatch: mockDispatch }),
}));
jest.mock('expo-router/react-navigation', () => ({
  usePreventRemove: (enabled: boolean, callback: typeof mockPrevent.callback) => {
    mockPrevent = { enabled, callback };
  },
}));
jest.mock('@/hooks/useAuth', () => ({
  useSession: () => mockSession,
  useAuth: () => ({ session: mockSession }),
}));
jest.mock('@/hooks/useProfile', () => ({
  useProfile: () => ({
    saveDisplayName: mockName,
    saveProfileDetails: (input: object) =>
      jest.requireMock('@/lib/api').api.updateProfileDetails(input),
  }),
}));
jest.mock('@/hooks/useAvatarSource', () => ({
  usePhotoCapabilities: () => ({
    uploadsEnabled: mockUploads,
    reportsEnabled: mockUploads,
    refresh: async () => {},
  }),
}));
jest.mock('@/components/Button', () => ({
  Button: (p: object) => jest.requireActual('react').createElement('test-button', p),
}));
jest.mock('@/components/Avatar', () => ({
  Avatar: (p: object) => jest.requireActual('react').createElement('test-avatar', p),
}));
jest.mock('@/components/ErrorState', () => ({
  ErrorState: (p: object) => jest.requireActual('react').createElement('test-error', p),
}));
jest.mock('@/components', () => ({
  ...jest.requireActual('@/components/theme'),
  Button: (p: object) => jest.requireActual('react').createElement('test-button', p),
  ErrorState: (p: object) => jest.requireActual('react').createElement('test-error', p),
  Screen: ({
    fixedHeader,
    children,
  }: {
    fixedHeader: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <>
      {fixedHeader}
      {children}
    </>
  ),
}));
jest.mock('@/lib/api', () => ({
  api: {
    getMyUserProfile: jest.fn(),
    updateProfileDetails: jest.fn(),
    uploadAvatar: jest.fn(),
    removeAvatar: jest.fn(),
  },
}));
jest.mock('@/lib/pickProfilePhoto', () => ({
  ...jest.requireActual('@/lib/pickProfilePhoto'),
  pickProfilePhoto: jest.fn(),
}));
const profile: UserProfile = {
  id: 'me',
  displayName: 'Ava',
  username: 'ava',
  isOwner: true,
  metadataVisible: true,
  shareMetadata: false,
  favoriteCuisine: 'Japanese',
  favoriteActivity: 'Bowling',
  avatarUrl: null,
  avatarRef: null,
  avatarRevision: 0,
  friendsCount: 3,
  groupsCount: 1,
  mutualGroups: [],
};
let tree: any;
const button = (label: string) =>
  tree.root.findAllByType('test-button').find((n: any) => n.props.label === label);
const field = (label: string) =>
  tree.root.findAllByProps({ accessibilityLabel: label }).find((n: any) => n.props.onChangeText);
const toggle = () =>
  tree.root
    .findAllByProps({ accessibilityLabel: 'Share profile metadata with friends' })
    .find((n: any) => n.props.onValueChange);
const errors = () =>
  tree.root
    .findAllByType('test-error')
    .map((n: any) => n.props.message)
    .join(' ');
async function mount() {
  await act(async () => {
    tree = create(<EditProfileSettings />);
  });
}
async function change(label: string, value: string) {
  await act(async () => field(label).props.onChangeText(value));
}
async function press(label: string) {
  await act(async () => button(label).props.onPress());
}
beforeEach(() => {
  jest.clearAllMocks();
  mockSession = { user: { id: 'me', email: 'me@example.test' } };
  mockUploads = false;
  mockSection = undefined;
  mockName.mockReset().mockResolvedValue(undefined);
  jest.mocked(api.getMyUserProfile).mockReset().mockResolvedValue(profile);
  jest
    .mocked(api.updateProfileDetails)
    .mockReset()
    .mockImplementation(async (input) => ({ ...profile, ...input }));
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  tree = undefined;
});

test('one inline form contains identity, favorites, privacy and an avatar without duplicate cards or a modal', async () => {
  await mount();
  for (const label of ['Display name', 'Username', 'Favorite cuisine', 'Favorite activity'])
    expect(field(label)).toBeDefined();
  expect(toggle().props.value).toBe(false);
  expect(button('Save').props.disabled).toBe(true);
  expect(button('Change photo')).toBeUndefined();
  expect(tree.root.findByType('test-avatar').props.userId).toBe('me');
  expect(JSON.stringify(tree.toJSON())).toContain('Photo uploads are currently unavailable.');
  expect(JSON.stringify(tree.toJSON())).not.toContain('Profile details & privacy');
});
test('Save normalizes identity and persists all text and privacy changes using existing endpoints', async () => {
  await mount();
  await change('Display name', '  Ava Jones  ');
  await change('Username', '@AVA_JONES');
  await change('Favorite cuisine', 'Thai');
  await change('Favorite activity', 'Hiking');
  await act(async () => toggle().props.onValueChange(true));
  await press('Save');
  expect(api.updateProfileDetails).toHaveBeenCalledWith({
    username: 'ava_jones',
    favoriteCuisine: 'Thai',
    favoriteActivity: 'Hiking',
    shareMetadata: true,
    birthday: null,
    shareBirthday: false,
  });
  expect(mockName).toHaveBeenCalledWith('Ava Jones');
  expect(button('Save').props.disabled).toBe(true);
  expect(JSON.stringify(tree.toJSON())).toContain('Profile details saved.');
  // Persisted owner response restores the same preference on reopening.
  jest.mocked(api.getMyUserProfile).mockResolvedValue({
    ...profile,
    displayName: 'Ava Jones',
    username: 'ava_jones',
    favoriteCuisine: 'Thai',
    favoriteActivity: 'Hiking',
    shareMetadata: true,
  });
  await act(async () => tree.unmount());
  await mount();
  expect(toggle().props.value).toBe(true);
  expect(field('Username').props.value).toBe('ava_jones');
});
test.each([
  ['Display name', ' '],
  ['Username', 'ab'],
  ['Username', 'support'],
  ['Favorite cuisine', 'a'.repeat(61)],
  ['Favorite activity', 'two\nlines'],
])('invalid %s is rejected before either write', async (label, value) => {
  await mount();
  await change(label, value);
  await press('Save');
  expect(errors()).not.toBe('');
  expect(api.updateProfileDetails).not.toHaveBeenCalled();
  expect(mockName).not.toHaveBeenCalled();
});
test.each(['admin', 'legacy-name'])(
  'unchanged grandfathered username %s remains editable',
  async (username) => {
    jest.mocked(api.getMyUserProfile).mockResolvedValue({ ...profile, username });
    await mount();
    await change('Favorite activity', 'Hiking');
    await press('Save');
    expect(api.updateProfileDetails).toHaveBeenCalledWith(expect.objectContaining({ username }));
  },
);
test('case-insensitive username conflict preserves every draft and does not save the name', async () => {
  jest
    .mocked(api.updateProfileDetails)
    .mockRejectedValueOnce(new Error('That username is already taken'));
  await mount();
  await change('Username', '@TAKEN');
  await change('Display name', 'New Name');
  await press('Save');
  expect(api.updateProfileDetails).toHaveBeenCalledWith(
    expect.objectContaining({ username: 'taken' }),
  );
  expect(errors()).toContain('already taken');
  expect(field('Username').props.value).toBe('@TAKEN');
  expect(field('Display name').props.value).toBe('New Name');
  expect(mockName).not.toHaveBeenCalled();
  await change('Username', '@AVAILABLE');
  await press('Save');
  expect(errors()).toBe('');
  expect(mockName).toHaveBeenCalledWith('New Name');
});
test('partial text success is explicit and retry only saves the remaining name', async () => {
  mockName.mockRejectedValueOnce(new Error('Offline'));
  await mount();
  await change('Username', 'ava_new');
  await change('Display name', 'New Name');
  await press('Save');
  expect(errors()).toContain(
    'Username, favorites, birthday and privacy saved. Display name could not be confirmed saved',
  );
  expect(button('Save').props.disabled).toBe(false);
  await press('Save');
  expect(api.updateProfileDetails).toHaveBeenCalledTimes(1);
  expect(mockName).toHaveBeenCalledTimes(2);
  expect(button('Save').props.disabled).toBe(true);
});
test('duplicate Save taps and photo actions cannot overlap a text request', async () => {
  mockUploads = true;
  let finish!: (p: UserProfile) => void;
  jest.mocked(api.updateProfileDetails).mockReturnValueOnce(
    new Promise((r) => {
      finish = r;
    }),
  );
  await mount();
  await change('Username', 'ava_new');
  await act(async () => {
    button('Save').props.onPress();
    button('Save').props.onPress();
    button('Change photo').props.onPress();
  });
  expect(api.updateProfileDetails).toHaveBeenCalledTimes(1);
  expect(pickProfilePhoto).not.toHaveBeenCalled();
  expect(button('Back').props.disabled).toBe(true);
  await act(async () => finish({ ...profile, username: 'ava_new' }));
});
test('photo upload is explicit and independent, preserves unsaved text, and removal works when uploads are paused', async () => {
  mockUploads = true;
  jest.mocked(pickProfilePhoto).mockResolvedValueOnce({
    bytes: new Uint8Array([255, 216]),
    previewUri: 'data:image/jpeg;base64,photo',
  });
  jest
    .mocked(api.uploadAvatar)
    .mockResolvedValueOnce({ revision: 1, avatarRef: { userId: 'me', revision: 1 } });
  await mount();
  await change('Display name', 'Unsaved name');
  await press('Change photo');
  await press('Save'); // Header only saves text; never silently uploads the preview.
  expect(api.uploadAvatar).not.toHaveBeenCalled();
  await change('Display name', 'Another draft');
  await press('Save photo');
  expect(JSON.stringify(tree.toJSON())).toContain('Photo saved.');
  expect(field('Display name').props.value).toBe('Another draft');
  expect(api.updateProfileDetails).not.toHaveBeenCalled();
  mockUploads = false;
  await act(async () => tree.update(<EditProfileSettings />));
  expect(button('Change photo')).toBeUndefined();
  jest.mocked(api.removeAvatar).mockResolvedValueOnce({ revision: 2, avatarRef: null });
  await press('Remove photo');
  expect(api.removeAvatar).toHaveBeenCalledWith('me', 1);
  expect(tree.root.findByType('test-avatar').props.avatarRef).toBeNull();
  expect(field('Display name').props.value).toBe('Another draft');
});
test('photo failure never marks text saved, retains the preview and prevents text Save during upload', async () => {
  mockUploads = true;
  jest
    .mocked(pickProfilePhoto)
    .mockResolvedValueOnce({ bytes: new Uint8Array([255, 216]), previewUri: 'preview' });
  let fail!: (e: Error) => void;
  jest.mocked(api.uploadAvatar).mockReturnValueOnce(
    new Promise((_, reject) => {
      fail = reject;
    }),
  );
  await mount();
  await change('Username', 'ava_new');
  await press('Change photo');
  await act(async () => {
    button('Save photo').props.onPress();
    button('Save').props.onPress();
  });
  expect(api.updateProfileDetails).not.toHaveBeenCalled();
  await act(async () => fail(new Error('Offline')));
  expect(errors()).toContain('Offline');
  expect(field('Username').props.value).toBe('ava_new');
  expect(button('Save photo')).toBeDefined();
  expect(JSON.stringify(tree.toJSON())).not.toContain('Profile details saved.');
});
test('loading failure retries and a non-owner response cannot expose an editable form', async () => {
  jest.mocked(api.getMyUserProfile).mockRejectedValueOnce(new Error('Offline'));
  await mount();
  expect(errors()).toContain('Offline');
  jest
    .mocked(api.getMyUserProfile)
    .mockResolvedValueOnce({ ...profile, id: 'other', isOwner: false });
  await act(async () => tree.root.findByType('test-error').props.onRetry());
  expect(field('Display name')).toBeUndefined();
  expect(errors()).toContain('could not be verified');
});
test('switching accounts during details Save prevents the subsequent name request', async () => {
  let finish!: (p: UserProfile) => void;
  jest.mocked(api.updateProfileDetails).mockReturnValueOnce(
    new Promise((r) => {
      finish = r;
    }),
  );
  await mount();
  await change('Username', 'ava_new');
  await change('Display name', 'Old Account');
  await press('Save');
  mockSession = { user: { id: 'other', email: 'other@example.test' } };
  jest
    .mocked(api.getMyUserProfile)
    .mockResolvedValue({ ...profile, id: 'other', displayName: 'Other' });
  await act(async () => tree.update(<EditProfileSettings />));
  await act(async () => finish({ ...profile, username: 'ava_new' }));
  expect(mockName).not.toHaveBeenCalled();
  expect(field('Display name').props.value).toBe('Other');
});
test('Back navigates normally when clean and offers discard protection for unsaved edits', async () => {
  await mount();
  await press('Back');
  expect(router.back).toHaveBeenCalled();
  expect(mockPrevent.enabled).toBe(false);
  await change('Display name', 'Unsaved');
  expect(mockPrevent.enabled).toBe(true);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await act(async () => mockPrevent.callback({ data: { action: { type: 'GO_BACK' } } }));
  expect(alert).toHaveBeenCalledWith(
    'Discard unsaved changes?',
    expect.any(String),
    expect.any(Array),
  );
  alert.mockRestore();
});

test('the existing privacy link opens the same inline form and scrolls to privacy once', async () => {
  mockSection = 'privacy';
  await mount();
  const target = tree.root.findAll((n: any) => typeof n.props.onLayout === 'function')[0];
  expect(target).toBeDefined();
  await act(async () => target.props.onLayout({ nativeEvent: { layout: { y: 400 } } }));
  expect(toggle()).toBeDefined();
  expect(field('Display name')).toBeDefined();
  expect(JSON.stringify(tree.toJSON())).not.toContain('Profile details & privacy');
});
test('sharing can be turned off without changing identity or invoking the name endpoint', async () => {
  jest.mocked(api.getMyUserProfile).mockResolvedValue({ ...profile, shareMetadata: true });
  await mount();
  expect(toggle().props.value).toBe(true);
  await act(async () => toggle().props.onValueChange(false));
  await press('Save');
  expect(api.updateProfileDetails).toHaveBeenCalledWith(
    expect.objectContaining({ username: 'ava', shareMetadata: false }),
  );
  expect(toggle().props.value).toBe(false);
  expect(mockName).not.toHaveBeenCalled();
});

test('birthday uses the owner month/day, defaults sharing off, and persists together with profile details', async () => {
  jest
    .mocked(api.getMyUserProfile)
    .mockResolvedValue({ ...profile, birthday: { month: 2, day: 29 }, shareBirthday: false });
  await mount();
  expect(JSON.stringify(tree.toJSON())).toContain('February 29');
  const birthdayToggle = () =>
    tree.root
      .findAllByProps({ accessibilityLabel: 'Show birthday to friends' })
      .find((n: any) => n.props.onValueChange);
  expect(birthdayToggle().props.value).toBe(false);
  const field = tree.root.findAll((n: any) => n.type?.name === 'BirthdayField')[0];
  await act(async () => field.props.onChange({ month: 12, day: 31 }));
  await act(async () => birthdayToggle().props.onValueChange(true));
  await press('Save');
  expect(api.updateProfileDetails).toHaveBeenCalledWith(
    expect.objectContaining({ birthday: { month: 12, day: 31 }, shareBirthday: true }),
  );
  expect(button('Save').props.disabled).toBe(true);
  expect(mockName).not.toHaveBeenCalled();
});
test('invalid birthday prevents every write; partial success retains the confirmed birthday on retry', async () => {
  await mount();
  const birthday = () => tree.root.findAll((n: any) => n.type?.name === 'BirthdayField')[0];
  await act(async () => birthday().props.onChange({ month: 2, day: 30 }));
  await change('Display name', 'Updated');
  await press('Save');
  expect(errors()).toContain('valid birthday');
  expect(api.updateProfileDetails).not.toHaveBeenCalled();
  expect(mockName).not.toHaveBeenCalled();
  await act(async () => birthday().props.onChange({ month: 2, day: 29 }));
  mockName.mockRejectedValueOnce(new Error('Offline'));
  await press('Save');
  expect(errors()).toContain('birthday and privacy saved');
  await press('Save');
  expect(api.updateProfileDetails).toHaveBeenCalledTimes(1);
  expect(birthday().props.value).toEqual({ month: 2, day: 29 });
});

test('web discard protection supports keeping and discarding edits', async () => {
  const os = Platform.OS;
  const original = globalThis.confirm;
  Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
  globalThis.confirm = jest.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
  try {
    await mount();
    await change('Display name', 'Unsaved');
    await act(async () => mockPrevent.callback({ data: { action: { type: 'GO_BACK' } } }));
    expect(mockDispatch).not.toHaveBeenCalled();
    await act(async () => mockPrevent.callback({ data: { action: { type: 'GO_BACK' } } }));
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'GO_BACK' });
  } finally {
    Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
    globalThis.confirm = original;
  }
});
test('birthday object key order does not cause a metadata write when only the name changes', async () => {
  jest
    .mocked(api.getMyUserProfile)
    .mockResolvedValue({ ...profile, birthday: { day: 29, month: 2 } });
  await mount();
  await change('Display name', 'Ava Edited');
  await press('Save');
  expect(api.updateProfileDetails).not.toHaveBeenCalled();
  expect(mockName).toHaveBeenCalledWith('Ava Edited');
});
