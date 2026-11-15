import React from 'react';
import UserProfileScreen from '../../app/users/[id]';
import { api } from '@/lib/api';
const { create, act } = jest.requireActual('react-test-renderer');
let mockId = 'first';
let mockViewer = 'viewer';
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: mockId }),
  useFocusEffect: (fn: () => void) => jest.requireActual('react').useEffect(fn, [fn]),
}));
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ session: { user: { id: mockViewer } } }),
}));
jest.mock('@/hooks/useAvatarSource', () => ({ useAvatarPhoto: () => ({ uri: null, ref: null }) }));
jest.mock('@/lib/api', () => ({ api: { getUserProfile: jest.fn() } }));
jest.mock('@/components/MemberMenu', () => ({ MemberMenu: () => null }));
jest.mock('@/components/PastMoves', () => ({ PastMoves: () => null }));
jest.mock('@/components/MessageFriendButton', () => ({ MessageFriendButton: () => null }));
jest.mock('@/components/UserProfileMetadata', () => ({ UserProfileMetadata: () => null }));
jest.mock('@/components', () => ({
  ...jest.requireActual('@/components/theme'),
  Screen: ({ right, ...p }: { right?: React.ReactNode }) =>
    jest.requireActual('react').createElement('test-screen', p, right, (p as any).children),
  Avatar: () => null,
  ErrorState: (p: object) => jest.requireActual('react').createElement('test-error', p),
}));
let tree: any;
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
const profile = (id: string, name = id) =>
  ({ id, displayName: name, username: id, isOwner: false, metadataVisible: false }) as any;
const loading = () =>
  tree.root.findAllByProps({ accessibilityLabel: 'Loading profile' }).length > 0;
const text = () => JSON.stringify(tree.toJSON());
beforeEach(() => {
  jest.clearAllMocks();
  mockId = 'first';
  mockViewer = 'viewer';
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  tree = null;
});
test('new target and viewer immediately replace old identity with skeletons, never previous-account content', async () => {
  jest.mocked(api.getUserProfile).mockResolvedValueOnce(profile('first', 'Private First'));
  await act(async () => {
    tree = create(<UserProfileScreen />);
  });
  expect(loading()).toBe(false);
  expect(text()).toContain('Private First');
  const second = deferred<any>();
  jest.mocked(api.getUserProfile).mockReturnValueOnce(second.promise);
  mockId = 'second';
  await act(async () => tree.update(<UserProfileScreen />));
  expect(loading()).toBe(true);
  expect(text()).not.toContain('Private First');
  const other = deferred<any>();
  jest.mocked(api.getUserProfile).mockReturnValueOnce(other.promise);
  mockViewer = 'other-viewer';
  await act(async () => tree.update(<UserProfileScreen />));
  await act(async () => second.resolve(profile('second', 'Previous viewer private name')));
  expect(loading()).toBe(true);
  expect(text()).not.toContain('Previous viewer private name');
  await act(async () => other.resolve(profile('second', 'Authorized Second')));
  expect(loading()).toBe(false);
  expect(text()).toContain('Authorized Second');
});
test('same-target refreshing keeps authorized identity; late responses and denials cannot restore it', async () => {
  jest.mocked(api.getUserProfile).mockResolvedValue(profile('first', 'Authorized First'));
  await act(async () => {
    tree = create(<UserProfileScreen />);
  });
  const older = deferred<any>();
  jest.mocked(api.getUserProfile).mockReturnValueOnce(older.promise);
  await act(async () => tree.root.findByType('test-screen').props.onRefresh());
  expect(text()).toContain('Authorized First');
  expect(loading()).toBe(false);
  jest
    .mocked(api.getUserProfile)
    .mockRejectedValueOnce(Object.assign(new Error('Unavailable'), { status: 404 }));
  await act(async () => tree.root.findByType('test-screen').props.onRefresh());
  expect(text()).not.toContain('Authorized First');
  expect(loading()).toBe(false);
  expect(tree.root.findByType('test-error').props.message).toBe('Unavailable');
  await act(async () => older.resolve(profile('first', 'Stale private identity')));
  expect(text()).not.toContain('Stale private identity');
  jest.mocked(api.getUserProfile).mockRejectedValueOnce(new Error('Offline'));
  await act(async () => tree.root.findByType('test-error').props.onRetry());
  expect(tree.root.findByType('test-error').props.message).toBe('Offline');
  expect(loading()).toBe(false);
});
