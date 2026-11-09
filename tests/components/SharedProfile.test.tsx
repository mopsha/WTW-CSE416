import React from 'react';
import SharedProfile from '../../app/p/[id]';
import { api, ApiError } from '@/lib/api';
import { router } from 'expo-router';
import { setPendingProfile } from '@/lib/pendingProfile';
const { create, act } = jest.requireActual('react-test-renderer');
const id = 'a0360002-3333-4333-8333-333333333333';
let mockId = id;
let mockSession: any = { user: { id: 'viewer' } };
let mockIdentity: any = {
  displayName: 'Viewer',
  username: 'viewer',
  loading: false,
  failed: false,
};
jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => ({ id: mockId }),
}));
jest.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ session: mockSession }) }));
jest.mock('@/hooks/useProfile', () => ({ useProfile: () => mockIdentity }));
jest.mock('@/hooks/usePrivateRefresh', () => ({
  usePrivateRefresh: (load: () => void, clear: () => void) =>
    jest.requireActual('react').useEffect(() => {
      load();
      return clear;
    }, [load, clear]),
}));
jest.mock('@/lib/api', () => ({
  ApiError: jest.requireActual('@/lib/api').ApiError,
  api: { getPerson: jest.fn() },
}));
jest.mock('@/lib/pendingProfile', () => ({ setPendingProfile: jest.fn(async () => {}) }));
jest.mock('@/components', () => ({
  Screen: ({ children }: any) => children,
  ErrorState: (p: object) => jest.requireActual('react').createElement('test-error', p),
  Button: (p: object) => jest.requireActual('react').createElement('test-button', p),
  colors: {},
  space: {},
  type: { body: {}, heading: {} },
}));
jest.mock('@/components/friends/SocialRow', () => ({
  SocialIdentity: (p: object) => jest.requireActual('react').createElement('test-identity', p),
}));
jest.mock('@/components/friends/UsernameFriendSearch', () => ({
  PersonFriendAction: (p: object) => jest.requireActual('react').createElement('test-request', p),
}));
jest.mock('@/components/MemberMenu', () => ({
  MemberMenu: (p: object) => jest.requireActual('react').createElement('test-menu', p),
}));
let tree: any;
beforeEach(() => {
  jest.clearAllMocks();
  mockId = id;
  mockSession = { user: { id: 'viewer' } };
  mockIdentity = { displayName: 'Viewer', username: 'viewer', loading: false, failed: false };
  jest
    .mocked(api.getPerson)
    .mockResolvedValue({ userId: id, displayName: 'Ava', username: 'ava', relationship: 'none' });
});
afterEach(async () => {
  await act(async () => tree?.unmount());
});
async function mount() {
  await act(async () => {
    tree = create(<SharedProfile />);
  });
}
test('signed-out entry parks the stable target and navigates to existing sign-in', async () => {
  mockSession = null;
  await mount();
  expect(setPendingProfile).toHaveBeenCalledWith(id, mockSession?.user.id);
  expect(router.replace).toHaveBeenCalledWith('/sign-in');
  expect(api.getPerson).not.toHaveBeenCalled();
});
test('a missing username goes through required identity setup before any lookup', async () => {
  mockIdentity.username = null;
  await mount();
  expect(setPendingProfile).toHaveBeenCalledWith(id, mockSession?.user.id);
  expect(router.replace).toHaveBeenCalledWith('/welcome');
  expect(api.getPerson).not.toHaveBeenCalled();
});
test('nonfriends receive only identity/request controls; full profile opens only for eligible friends', async () => {
  await mount();
  expect(tree.root.findAllByType('test-request')).toHaveLength(1);
  expect(tree.root.findAllByType('test-button')).toHaveLength(0);
  jest.mocked(api.getPerson).mockResolvedValue({
    userId: id,
    displayName: 'Ava',
    username: 'ava_new',
    relationship: 'friends',
  });
  await act(async () => tree.root.findByType('test-request').props.onChanged());
  await act(async () => tree.root.findByType('test-button').props.onPress());
  expect(router.push).toHaveBeenCalledWith({ pathname: '/users/[id]', params: { id } });
});
test.each(['deleted', 'blocked'])('%s targets leave no rendered identity', async () => {
  jest.mocked(api.getPerson).mockRejectedValue(new Error('Profile unavailable'));
  await mount();
  expect(tree.root.findAllByType('test-identity')).toHaveLength(0);
  expect(tree.root.findByType('test-error').props.message).toBe('Profile unavailable');
});
test('malformed targets do not reach lookup or persist a sign-in intent', async () => {
  mockId = '../bad';
  await mount();
  expect(api.getPerson).not.toHaveBeenCalled();
  expect(setPendingProfile).not.toHaveBeenCalled();
});

test('optional setup preserves the link intent until the root finishes offering onboarding', async () => {
  mockIdentity.optionalSetupPending = true;
  await mount();
  expect(setPendingProfile).toHaveBeenCalledWith(id, mockSession?.user.id);
  expect(api.getPerson).not.toHaveBeenCalled();
  expect(router.replace).toHaveBeenCalledWith('/onboarding');
});

test('a limited reconciliation preserves identity and the mounted confirmed friend action', async () => {
  await mount();
  jest.mocked(api.getPerson).mockRejectedValueOnce(new Error('Discovery quota exhausted'));
  await act(async () => {
    await expect(tree.root.findByType('test-request').props.onChanged()).rejects.toThrow(
      'Discovery quota exhausted',
    );
  });
  expect(tree.root.findAllByType('test-identity')).toHaveLength(1);
  expect(tree.root.findAllByType('test-request')).toHaveLength(1);
  expect(tree.root.findAllByType('test-error')).toHaveLength(0);
});

test('confirmed denial during reconciliation removes the identity', async () => {
  await mount();
  jest
    .mocked(api.getPerson)
    .mockRejectedValueOnce(new ApiError('PROFILE_NOT_FOUND', 'Profile unavailable', 404));
  await act(async () => {
    await expect(tree.root.findByType('test-request').props.onChanged()).rejects.toThrow(
      'Profile unavailable',
    );
  });
  expect(tree.root.findAllByType('test-identity')).toHaveLength(0);
});

test('a new account still missing birthday parks a shared profile until required setup finishes', async () => {
  mockIdentity = {
    displayName: 'New',
    username: 'new_user',
    loading: false,
    failed: false,
    birthdayRequired: true,
  };
  await mount();
  expect(setPendingProfile).toHaveBeenCalled();
  expect(router.replace).toHaveBeenCalledWith('/welcome');
  expect(api.getPerson).not.toHaveBeenCalled();
});
