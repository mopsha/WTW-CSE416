import { createApiClient } from '@/lib/api';
import { MOCK_API_BASE_URL, mockFetch } from '@/lib/mock/api';
import { MOCK_ACCESS_TOKEN, MOCK_USER_ID } from '@/lib/mock/auth';
import { mockUserProfiles, mockBirthdays, resetOwnMockUserProfile } from '@/lib/mock/userProfiles';
import { resetMockGroups, mockGroupRecord } from '@/lib/mock/groups';
import { resetMockFriends } from '@/lib/mock/friends';
import { resetMockData, setMockBots } from '@/lib/mock/store';
const api = createApiClient({
  baseUrl: MOCK_API_BASE_URL,
  getAccessToken: async () => MOCK_ACCESS_TOKEN,
  fetch: mockFetch,
});
beforeEach(() => {
  resetMockData();
  resetMockGroups();
  resetMockFriends();
  resetOwnMockUserProfile();
  setMockBots(false);
});
afterAll(() => setMockBots(true));
test('owner sees all details; legacy own name and preferences contract is preserved', async () => {
  await api.updateMe('Josh');
  const p = await api.updateProfileDetails({
    username: '@Josh',
    favoriteCuisine: 'Japanese',
    favoriteActivity: 'Basketball',
    shareMetadata: false,
  });
  expect(p).toMatchObject({
    id: MOCK_USER_ID,
    isOwner: true,
    metadataVisible: true,
    displayName: 'Josh',
    username: 'josh',
    shareMetadata: false,
    favoriteCuisine: 'Japanese',
  });
  expect((await api.getMe()).displayName).toBe('Josh');
  expect((await api.getMyUserProfile()).username).toBe('josh');
});
test('visible friend profile includes only accessible mutual groups', async () => {
  const p = await api.getUserProfile('mock-ava');
  expect(p).toMatchObject({
    username: 'ava',
    favoriteCuisine: 'Japanese',
    metadataVisible: true,
    groupsCount: 3,
  });
  expect(p.mutualGroups.map((g) => g.id).sort()).toEqual([
    'mock-group-climbing',
    'mock-group-roommates',
  ]);
  expect(p.mutualGroups.some((g) => g.id === 'mock-group-weekend')).toBe(false);
  expect(p).not.toHaveProperty('preferences');
  expect(p).not.toHaveProperty('shareMetadata');
  expect(p).not.toHaveProperty('email');
});
test('private friend profile exposes identity but no counts, favorites or mutual groups', async () => {
  const p = await api.getUserProfile('mock-ben');
  expect(p).toMatchObject({
    username: 'ben',
    metadataVisible: false,
    friendsCount: null,
    groupsCount: null,
    favoriteCuisine: null,
    favoriteActivity: null,
    mutualGroups: [],
  });
});
test.each(['mock-jordan', 'unknown'])(
  'pending/nonfriend %s cannot retrieve a profile',
  async (id) => {
    await expect(api.getUserProfile(id)).rejects.toMatchObject({ status: 404 });
  },
);
test('blocks and friendship removal deny access despite shared groups', async () => {
  await api.blockUser('mock-ava');
  await expect(api.getUserProfile('mock-ava')).rejects.toMatchObject({ status: 404 });
  expect(mockGroupRecord('mock-group-roommates')!.memberIds).toContain('mock-ava');
  await api.removeFriend('mock-ben');
  await expect(api.getUserProfile('mock-ben')).rejects.toMatchObject({ status: 404 });
});
test('username collisions are case-insensitive, clearing releases own username, account deletion clears metadata', async () => {
  await expect(
    api.updateProfileDetails({
      username: 'AVA',
      favoriteCuisine: null,
      favoriteActivity: null,
      shareMetadata: false,
    }),
  ).rejects.toMatchObject({ code: 'USERNAME_TAKEN' });
  await api.updateProfileDetails({
    username: 'josh',
    favoriteCuisine: 'Italian',
    favoriteActivity: null,
    shareMetadata: true,
  });
  await api.deleteMe();
  expect(mockUserProfiles.has(MOCK_USER_ID)).toBe(false);
  expect((await api.getMyUserProfile()).username).toBeNull();
});
test('avatar reference is preserved when updating only metadata', async () => {
  mockUserProfiles.set(MOCK_USER_ID, {
    username: null,
    favoriteCuisine: null,
    favoriteActivity: null,
    shareMetadata: false,
    avatarUrl: 'https://example.com/avatar.png',
  });
  expect(
    (
      await api.updateProfileDetails({
        username: 'josh',
        favoriteCuisine: null,
        favoriteActivity: null,
        shareMetadata: false,
      })
    ).avatarUrl,
  ).toBe('https://example.com/avatar.png');
});

test('birthday sharing only projects month/day to accepted friends and revokes with privacy, blocks or removal', async () => {
  mockBirthdays.set('mock-ben', { birthday: { month: 2, day: 29 }, shareBirthday: false });
  expect(await api.getUserProfile('mock-ben')).not.toHaveProperty('birthday');
  mockBirthdays.set('mock-ben', { birthday: { month: 2, day: 29 }, shareBirthday: true });
  const friend = await api.getUserProfile('mock-ben');
  expect(friend).toMatchObject({ metadataVisible: false, birthday: { month: 2, day: 29 } });
  expect(friend.birthday).not.toHaveProperty('year');
  expect(friend).not.toHaveProperty('shareBirthday');
  expect(JSON.stringify(friend)).not.toContain('2000');
  mockBirthdays.set('mock-jordan', { birthday: { month: 1, day: 1 }, shareBirthday: true });
  await expect(api.getUserProfile('mock-jordan')).rejects.toMatchObject({ status: 404 });
  await api.removeFriend('mock-ben');
  await expect(api.getUserProfile('mock-ben')).rejects.toMatchObject({ status: 404 });
  mockBirthdays.set('mock-ava', { birthday: { month: 2, day: 29 }, shareBirthday: true });
  await api.blockUser('mock-ava');
  await expect(api.getUserProfile('mock-ava')).rejects.toMatchObject({ status: 404 });
  mockBirthdays.clear();
});
