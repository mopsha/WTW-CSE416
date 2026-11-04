import React from 'react';
import { Image } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { avatarCache, useAvatarLifecycle } from '@/hooks/useAvatarSource';
import { photoChanged } from '@/lib/photoEvents';
import { api } from '@/lib/api';
import type { AuthSession } from '@/lib/authTypes';
type Tree = {
  root: { findAllByType(t: unknown): { props: { source: { uri: string }; onError(): void } }[] };
  update(e: React.ReactElement): void;
  unmount(): void;
  toJSON(): unknown;
};
const { create, act } = jest.requireActual<{
  create(e: React.ReactElement): Tree;
  act(fn: () => void | Promise<void>): Promise<void>;
}>('react-test-renderer');
let mockSession: AuthSession | null = {
  user: { id: 'A', email: 'a@example.com' },
  accessToken: 'token',
};
jest.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ session: mockSession }) }));
jest.mock('expo-router', () => ({
  useFocusEffect: (fn: () => void) => jest.requireActual('react').useEffect(fn, [fn]),
}));
jest.mock('@/lib/api', () => ({ api: { getAvatar: jest.fn(), resolveAvatarRefs: jest.fn() } }));
const ref = { userId: 'friend', revision: 1 };
let tree: Tree | undefined;
function Harness({ resolve = false }: { resolve?: boolean }) {
  useAvatarLifecycle(mockSession?.user.id, '/profile', mockSession?.user.email);
  return <Avatar name="Ava" userId="friend" avatarRef={resolve ? undefined : ref} />;
}
beforeEach(() => {
  jest.clearAllMocks();
  tree = undefined;
  avatarCache.setViewer(null);
  avatarCache.setActive(true);
  mockSession = { user: { id: 'A', email: 'a@example.com' }, accessToken: 'token' };
  jest.mocked(api.getAvatar).mockResolvedValue('data:image/jpeg;base64,/9j/2Q==');
  jest.mocked(api.resolveAvatarRefs).mockResolvedValue({ friend: { revision: 1, avatarRef: ref } });
});
afterEach(async () => {
  await act(async () => tree?.unmount());
});
async function mount(resolve = false) {
  await act(async () => {
    tree = create(<Harness resolve={resolve} />);
  });
}
test('managed photos render memory sources; decode errors fall back to initials', async () => {
  await mount();
  const images = tree!.root.findAllByType(Image);
  expect(images[0]!.props.source.uri).toBe('data:image/jpeg;base64,/9j/2Q==');
  await act(async () => images[0]!.props.onError());
  expect(tree!.root.findAllByType(Image)).toHaveLength(0);
  expect(JSON.stringify(tree!.toJSON())).toContain('A');
});
test('denied downloads leave the initials fallback', async () => {
  jest.mocked(api.getAvatar).mockRejectedValue(new Error('404'));
  await mount();
  expect(api.getAvatar).toHaveBeenCalled();
  expect(tree!.root.findAllByType(Image)).toHaveLength(0);
});
test('removal clears pixels and replacement refreshes despite stale parent props', async () => {
  await mount();
  expect(tree!.root.findAllByType(Image)).toHaveLength(1);
  await act(async () => photoChanged('friend', { revision: 2, avatarRef: null }));
  expect(tree!.root.findAllByType(Image)).toHaveLength(0);
  jest.mocked(api.getAvatar).mockResolvedValueOnce('data:image/jpeg;base64,new');
  await act(async () =>
    photoChanged('friend', { revision: 3, avatarRef: { userId: 'friend', revision: 3 } }),
  );
  expect(tree!.root.findAllByType(Image)[0]!.props.source.uri).toBe('data:image/jpeg;base64,new');
});
test('sign-out prevents late private bytes from rendering', async () => {
  let finish!: (value: string) => void;
  jest.mocked(api.getAvatar).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await mount();
  expect(api.getAvatar).toHaveBeenCalled();
  mockSession = null;
  await act(async () => tree!.update(<Harness />));
  await act(async () => finish('data:image/jpeg;base64,old'));
  expect(tree!.root.findAllByType(Image)).toHaveLength(0);
});
test('switching mock accounts with the same fixture ID clears the previous source', async () => {
  await mount();
  expect(tree!.root.findAllByType(Image)).toHaveLength(1);
  jest.mocked(api.getAvatar).mockResolvedValue('data:image/jpeg;base64,second-account');
  mockSession = { user: { id: 'A', email: 'second@example.com' }, accessToken: 'token' };
  await act(async () => tree!.update(<Harness />));
  expect(tree!.root.findAllByType(Image)[0]!.props.source.uri).toBe(
    'data:image/jpeg;base64,second-account',
  );
});
test('person-only identities resolve in a batch and never download revision zero', async () => {
  await mount(true);
  expect(tree!.root.findAllByType(Image)).toHaveLength(1);
  expect(api.resolveAvatarRefs).toHaveBeenCalledWith('A', ['friend'], expect.anything());
  expect(api.getAvatar).toHaveBeenCalledWith('A', ref, expect.anything());
  expect(jest.mocked(api.getAvatar).mock.calls.every(([, photo]) => photo.revision > 0)).toBe(true);
});
