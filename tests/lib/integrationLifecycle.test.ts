import { createApiClient } from '@/lib/api';
import { MOCK_ACCESS_TOKEN, MOCK_USER_ID } from '@/lib/mock/auth';
import { mockFetch } from '@/lib/mock/api';
import {
  resetMockGroups,
  mockGroupRecord,
  mockGroupIdeas,
  mockListGroups,
} from '@/lib/mock/groups';
import { mockGroupInvitations } from '@/lib/mock/groupInvitations';
import { resetMockFriends } from '@/lib/mock/friends';
import { resetMockProfile, mockBlocks } from '@/lib/mock/store';
import { resetOwnMockUserProfile } from '@/lib/mock/userProfiles';
const api = createApiClient({
  baseUrl: 'https://mock.wtw.local/functions/v1/api',
  getAccessToken: async () => MOCK_ACCESS_TOKEN,
  fetch: mockFetch,
});
beforeEach(() => {
  resetMockGroups();
  resetMockFriends();
  resetMockProfile();
  resetOwnMockUserProfile();
  mockBlocks.clear();
});
test('pending -> accept grants chat/ideas; leave revokes both without deleting chat history', async () => {
  const id = 'mock-group-weekend';
  await expect(api.listGroupMessages(id)).rejects.toMatchObject({ status: 404 });
  await expect(api.listGroupIdeas(id)).rejects.toMatchObject({ status: 404 });
  await api.respondGroupInvitation('mock-group-invite-weekend', 'accepted');
  await api.sendGroupMessage(id, { body: 'Hello group', clientId: 'integration-001' });
  await api.createGroupIdea(id, { name: 'Basketball', category: 'activity' });
  expect((await api.listGroupMessages(id)).messages).toHaveLength(1);
  expect((await api.listGroupIdeas(id)).ideas).toHaveLength(1);
  await api.leaveGroup(id);
  await expect(api.listGroupMessages(id)).rejects.toMatchObject({ status: 404 });
  await expect(api.listGroupIdeas(id)).rejects.toMatchObject({ status: 404 });
  await expect(
    api.respondGroupInvitation('mock-group-invite-weekend', 'accepted'),
  ).rejects.toMatchObject({ status: 409 });
});
test('an established username cannot be cleared by a metadata edit', async () => {
  await api.completeIdentity('Josh', 'josh');
  await expect(
    api.updateProfileDetails({
      username: null,
      favoriteCuisine: 'Italian',
      favoriteActivity: null,
      shareMetadata: true,
    }),
  ).rejects.toMatchObject({ status: 400 });
  expect((await api.getMe()).username).toBe('josh');
});
test('account deletion cascades owned groups and removes membership in surviving groups', async () => {
  await api.createGroupIdea('mock-group-roommates', { name: 'Dinner', category: 'food' });
  await api.sendGroupMessage('mock-group-roommates', {
    body: 'Private group',
    clientId: 'integration-001',
  });
  await api.deleteMe();
  expect(mockGroupRecord('mock-group-roommates')).toBeUndefined();
  expect(mockGroupRecord('mock-group-climbing')!.memberIds).not.toContain(MOCK_USER_ID);
  expect(mockListGroups()).toEqual([]);
  expect(mockGroupIdeas.size).toBe(0);
  expect(
    [...mockGroupInvitations.values()].some(
      (i) => i.inviteeId === MOCK_USER_ID || i.inviterId === MOCK_USER_ID,
    ),
  ).toBe(false);
  await expect(api.listGroupMessages('mock-group-climbing')).rejects.toMatchObject({ status: 404 });
});
