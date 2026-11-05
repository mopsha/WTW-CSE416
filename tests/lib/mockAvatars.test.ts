import { createApiClient } from '@/lib/api';
import { MOCK_API_BASE_URL, mockFetch } from '@/lib/mock/api';
import { MOCK_ACCESS_TOKEN, MOCK_USER_ID, MOCK_CODE, mockAuth } from '@/lib/mock/auth';
import { mockUserProfiles, resetOwnMockUserProfile } from '@/lib/mock/userProfiles';
import { resetMockFriends } from '@/lib/mock/friends';
import { resetMockGroups, mockGroupRecord } from '@/lib/mock/groups';
import { resetMockData, setMockBots, mockBlocks } from '@/lib/mock/store';
import {
  openMockDirectConversation,
  listMockDirectMessages,
  sendMockDirectMessage,
} from '@/lib/mock/directChat';
import { listMockGroupMessages, sendMockGroupMessage } from '@/lib/mock/groupChat';
const bytes = new Uint8Array([255, 216, 255, 217]);
const api = createApiClient({
  baseUrl: MOCK_API_BASE_URL,
  getAccessToken: async () => MOCK_ACCESS_TOKEN,
  getSession: async () => ({
    user: { id: MOCK_USER_ID, email: 'demo@wtw.test' },
    accessToken: MOCK_ACCESS_TOKEN,
  }),
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
test('mock photo upload, replacement, retrieval and removal use existing profile state', async () => {
  expect((await api.getMyUserProfile()).avatarRevision).toBe(0);
  const first = await api.uploadAvatar(MOCK_USER_ID, 0, bytes);
  expect(first).toEqual({ revision: 1, avatarRef: { userId: MOCK_USER_ID, revision: 1 } });
  expect(await api.getAvatar(MOCK_USER_ID, first.avatarRef!)).toBe(
    'data:image/jpeg;base64,/9j/2Q==',
  );
  await api.updateProfileDetails({
    username: 'my_name',
    favoriteActivity: null,
    favoriteCuisine: null,
    shareMetadata: false,
  });
  expect((await api.getMyUserProfile()).avatarRef).toEqual(first.avatarRef);
  await api.uploadAvatar(MOCK_USER_ID, 1, bytes);
  await expect(api.uploadAvatar(MOCK_USER_ID, 1, bytes)).rejects.toMatchObject({ status: 409 });
  await expect(api.getAvatar(MOCK_USER_ID, first.avatarRef!)).rejects.toMatchObject({
    status: 404,
  });
  expect(await api.removeAvatar(MOCK_USER_ID, 2)).toEqual({ revision: 3, avatarRef: null });
  expect((await api.getMyUserProfile()).avatarRef).toBeNull();
});
test('mock visibility honors accepted friends, shared groups and Pick membership with blocking precedence', async () => {
  const original = mockUserProfiles.get('mock-ava')!;
  mockUserProfiles.set('mock-ava', { ...original, avatarRevision: 1, avatarData: '/9j/2Q==' });
  try {
    const resolved = await api.resolveAvatarRefs(MOCK_USER_ID, [
      'mock-ava',
      'mock-jordan',
      'unknown',
    ]);
    expect(resolved['mock-ava']?.avatarRef).toEqual({ userId: 'mock-ava', revision: 1 });
    expect(resolved['mock-jordan']).toBeUndefined();
    expect(resolved.unknown).toBeUndefined();
    expect(
      (await api.listFriends()).friends.find((p) => p.userId === 'mock-ava')?.avatarRef?.revision,
    ).toBe(1);
    mockBlocks.add('mock-ava');
    await expect(
      api.getAvatar(MOCK_USER_ID, { userId: 'mock-ava', revision: 1 }),
    ).rejects.toMatchObject({ status: 404 });
    expect((await api.resolveAvatarRefs(MOCK_USER_ID, ['mock-ava']))['mock-ava']).toBeUndefined();
  } finally {
    mockUserProfiles.set('mock-ava', original);
  }
});
test('mock photo metadata appears in direct and group history; account deletion removes bytes', async () => {
  await api.uploadAvatar(MOCK_USER_ID, 0, bytes);
  const direct = openMockDirectConversation(MOCK_USER_ID, 'mock-ava');
  sendMockDirectMessage(MOCK_USER_ID, direct.id, { body: 'Hello', clientId: 'photo-dm-0001' });
  expect(
    listMockDirectMessages(MOCK_USER_ID, direct.id).messages[0]?.senderAvatarRef?.revision,
  ).toBe(1);
  const group = mockGroupRecord('mock-group-roommates')!;
  sendMockGroupMessage(MOCK_USER_ID, group.id, { body: 'Hello', clientId: 'photo-group-0001' });
  expect(listMockGroupMessages(MOCK_USER_ID, group.id).at(-1)?.senderAvatarRef?.revision).toBe(1);
  await api.deleteMe();
  expect(mockUserProfiles.has(MOCK_USER_ID)).toBe(false);
});
test('mock photos survive their own sign-in session without crossing account snapshots', async () => {
  const client = createApiClient({
    baseUrl: MOCK_API_BASE_URL,
    getAccessToken: async () => (await mockAuth.getSession())?.accessToken ?? null,
    getSession: () => mockAuth.getSession(),
    fetch: mockFetch,
  });
  await mockAuth.sendCode('photo-owner-a@wtw.test', 'signup');
  await mockAuth.verifyCode('photo-owner-a@wtw.test', MOCK_CODE);
  try {
    await client.uploadAvatar(MOCK_USER_ID, 0, bytes);
    await mockAuth.signOut();
    await mockAuth.sendCode('photo-owner-b@wtw.test', 'signup');
    await mockAuth.verifyCode('photo-owner-b@wtw.test', MOCK_CODE);
    expect((await client.getMyUserProfile()).avatarRef).toBeNull();
    await mockAuth.signOut();
    await mockAuth.sendCode('photo-owner-a@wtw.test', 'login');
    await mockAuth.verifyCode('photo-owner-a@wtw.test', MOCK_CODE);
    expect((await client.getMyUserProfile()).avatarRef?.revision).toBe(1);
  } finally {
    await mockAuth.signOut();
  }
});
