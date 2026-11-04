import React, { useState } from 'react';
import { ProfilePhotoEditor } from '@/components/ProfilePhotoEditor';
import { api } from '@/lib/api';
import { pickProfilePhoto, PhotoSelectionError } from '@/lib/pickProfilePhoto';
import type { UserProfile } from '@shared/api/userProfiles.ts';
type Node = { props: { onPress(): void; message?: string; avatarRef?: unknown; uri?: string } };
type Tree = {
  root: { findAllByProps(p: object): Node[]; findAllByType(t: string): Node[] };
  update(e: React.ReactElement): void;
  unmount(): void;
};
const { create, act } = jest.requireActual<{
  create(e: React.ReactElement): Tree;
  act(fn: () => void | Promise<void>): Promise<void>;
}>('react-test-renderer');
let mockSession = { user: { id: 'A', email: 'a@example.com' } };
jest.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ session: mockSession }) }));
jest.mock('@/lib/pickProfilePhoto', () => ({
  ...jest.requireActual('@/lib/pickProfilePhoto'),
  pickProfilePhoto: jest.fn(),
}));
jest.mock('@/lib/api', () => ({
  api: { uploadAvatar: jest.fn(), removeAvatar: jest.fn(), getMyUserProfile: jest.fn() },
}));
jest.mock('@/components/Button', () => ({
  Button: (p: object) => jest.requireActual('react').createElement('photo-button', p),
}));
jest.mock('@/components/Avatar', () => ({
  Avatar: (p: object) => jest.requireActual('react').createElement('photo-avatar', p),
}));
jest.mock('@/components/ErrorState', () => ({
  ErrorState: (p: object) => jest.requireActual('react').createElement('photo-error', p),
}));
const profile: UserProfile = {
  id: 'A',
  displayName: 'Ava',
  username: 'ava',
  avatarUrl: null,
  isOwner: true,
  metadataVisible: true,
  friendsCount: 1,
  groupsCount: 1,
  favoriteCuisine: null,
  favoriteActivity: null,
  mutualGroups: [],
  avatarRevision: 0,
  avatarRef: null,
};
const selected = {
  bytes: new Uint8Array([255, 216, 255, 217]),
  previewUri: 'data:image/jpeg;base64,/9j/2Q==',
};
const picked = jest.mocked(pickProfilePhoto);
const saved = jest.fn();
let tree: Tree | undefined;
function Harness({ initial = profile }: { initial?: UserProfile }) {
  const [p, setP] = useState(initial);
  return (
    <ProfilePhotoEditor
      profile={p}
      onSaved={(next) => {
        saved(next);
        setP(next);
      }}
      onBusyChange={() => {}}
    />
  );
}
beforeEach(() => {
  jest.clearAllMocks();
  tree = undefined;
  mockSession = { user: { id: 'A', email: 'a@example.com' } };
});
afterEach(async () => {
  await act(async () => tree?.unmount());
});
async function mount(initial = profile) {
  await act(async () => {
    tree = create(<Harness initial={initial} />);
  });
}
async function press(label: string) {
  await act(async () => tree!.root.findAllByProps({ label })[0]!.props.onPress());
}
test('cancelled selection leaves the persisted photo and performs no upload', async () => {
  picked.mockResolvedValueOnce(null);
  await mount();
  await press('Change photo');
  expect(tree!.root.findAllByProps({ label: 'Save photo' })).toHaveLength(0);
  expect(api.uploadAvatar).not.toHaveBeenCalled();
});
test('previews first, ignores rapid repeated save taps and publishes the successful revision', async () => {
  picked.mockResolvedValueOnce(selected);
  let finish!: (value: {
    revision: number;
    avatarRef: { userId: string; revision: number };
  }) => void;
  jest.mocked(api.uploadAvatar).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await mount();
  await press('Change photo');
  expect(api.uploadAvatar).not.toHaveBeenCalled();
  expect(tree!.root.findAllByType('photo-avatar')[0]!.props.uri).toBe(selected.previewUri);
  await act(async () => {
    const button = tree!.root.findAllByProps({ label: 'Save photo' })[0]!;
    button.props.onPress();
    button.props.onPress();
  });
  expect(api.uploadAvatar).toHaveBeenCalledTimes(1);
  expect(api.uploadAvatar).toHaveBeenCalledWith('A', 0, selected.bytes);
  await act(async () => finish({ revision: 1, avatarRef: { userId: 'A', revision: 1 } }));
  expect(saved).toHaveBeenLastCalledWith(
    expect.objectContaining({
      username: 'ava',
      avatarRevision: 1,
      avatarRef: { userId: 'A', revision: 1 },
    }),
  );
  expect(tree!.root.findAllByProps({ label: 'Save photo' })).toHaveLength(0);
});
test('conflict retains the preview, refreshes the revision, and requires explicit retry', async () => {
  picked.mockResolvedValueOnce(selected);
  jest.mocked(api.uploadAvatar).mockRejectedValueOnce(new Error('Photo changed'));
  jest.mocked(api.getMyUserProfile).mockResolvedValueOnce({ ...profile, avatarRevision: 4 });
  await mount();
  await press('Change photo');
  await press('Save photo');
  expect(tree!.root.findAllByType('photo-error')[0]!.props.message).toBe('Photo changed');
  expect(saved).toHaveBeenCalledWith(expect.objectContaining({ avatarRevision: 4 }));
  expect(tree!.root.findAllByType('photo-avatar')[0]!.props.uri).toBe(selected.previewUri);
  expect(api.uploadAvatar).toHaveBeenCalledTimes(1);
  jest
    .mocked(api.uploadAvatar)
    .mockResolvedValueOnce({ revision: 5, avatarRef: { userId: 'A', revision: 5 } });
  await press('Save photo');
  expect(api.uploadAvatar).toHaveBeenLastCalledWith('A', 4, selected.bytes);
});
test('remove returns to initials without clearing unrelated profile details', async () => {
  jest.mocked(api.removeAvatar).mockResolvedValueOnce({ revision: 3, avatarRef: null });
  await mount({ ...profile, avatarRevision: 2, avatarRef: { userId: 'A', revision: 2 } });
  await press('Remove photo');
  expect(saved).toHaveBeenCalledWith(
    expect.objectContaining({ username: 'ava', avatarRef: null, avatarRevision: 3 }),
  );
  expect(tree!.root.findAllByProps({ label: 'Remove photo' })).toHaveLength(0);
  expect(tree!.root.findAllByType('photo-avatar')[0]!.props.avatarRef).toBeNull();
});
test('permission denial offers settings without touching the API', async () => {
  picked.mockRejectedValueOnce(new PhotoSelectionError(true, 'Photo access denied'));
  await mount();
  await press('Change photo');
  expect(tree!.root.findAllByProps({ label: 'Open photo settings' }).length).toBeGreaterThan(0);
  expect(api.getMyUserProfile).not.toHaveBeenCalled();
  expect(saved).not.toHaveBeenCalled();
});
test('an offline replacement preserves the persisted photo and allows cancelling its preview', async () => {
  picked.mockResolvedValueOnce(selected);
  jest.mocked(api.uploadAvatar).mockRejectedValueOnce(new Error('Offline'));
  jest.mocked(api.getMyUserProfile).mockRejectedValueOnce(new Error('Offline'));
  const previous = { userId: 'A', revision: 2 };
  await mount({ ...profile, avatarRevision: 2, avatarRef: previous });
  await press('Change photo');
  await press('Save photo');
  expect(saved).not.toHaveBeenCalled();
  expect(tree!.root.findAllByType('photo-error')[0]!.props.message).toBe('Offline');
  await press('Cancel photo change');
  expect(tree!.root.findAllByType('photo-avatar')[0]!.props.avatarRef).toEqual(previous);
});
test('account switching discards a pending upload result and the previous preview', async () => {
  picked.mockResolvedValueOnce(selected);
  let finish!: (value: { revision: number; avatarRef: null }) => void;
  jest.mocked(api.uploadAvatar).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await mount();
  await press('Change photo');
  await press('Save photo');
  mockSession = { user: { id: 'B', email: 'b@example.com' } };
  await act(async () => tree!.update(<Harness />));
  await act(async () => finish({ revision: 1, avatarRef: null }));
  expect(saved).not.toHaveBeenCalled();
  expect(tree!.root.findAllByProps({ label: 'Save photo' })).toHaveLength(0);
});
