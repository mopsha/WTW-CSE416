import { createApiClient } from '@/lib/api';
import { MOCK_API_BASE_URL, mockFetch, mockNotifications } from '@/lib/mock/api';
import { MOCK_ACCESS_TOKEN, MOCK_USER_ID } from '@/lib/mock/auth';
import {
  listMockGroupInvitations,
  mockGroupInvitations,
  resolveMockGroupInvitation,
} from '@/lib/mock/groupInvitations';
import { mockGroupRecord, mockGetGroup, resetMockGroups } from '@/lib/mock/groups';
import { resetMockFriends } from '@/lib/mock/friends';
import { resetMockData, setMockBots } from '@/lib/mock/store';
const api = createApiClient({
  baseUrl: MOCK_API_BASE_URL,
  getAccessToken: async () => MOCK_ACCESS_TOKEN,
  fetch: mockFetch,
});
const group = 'mock-group-roommates',
  weekend = 'mock-group-weekend';
beforeEach(() => {
  resetMockData();
  resetMockGroups();
  resetMockFriends();
  setMockBots(false);
});
afterAll(() => setMockBots(true));
test('owner sends pending requests, duplicates/member requests add no membership', async () => {
  const before = mockGetGroup(group)!.members.length;
  expect(await api.addGroupMembers(group, ['mock-cam', 'mock-cam'])).toEqual({
    invited: 1,
    added: 0,
  });
  expect(mockGetGroup(group)!.members.length).toBe(before);
  const pending = (await api.listPendingGroupInvitations(group)).invitations;
  expect(pending).toHaveLength(1);
  expect(pending[0]).toMatchObject({
    inviterId: MOCK_USER_ID,
    inviteeId: 'mock-cam',
    status: 'pending',
  });
  expect(await api.addGroupMembers(group, ['mock-cam'])).toEqual({ invited: 0, added: 0 });
  expect(await api.addGroupMembers(group, ['mock-ava'])).toEqual({ invited: 0, added: 0 });
  expect((await api.listPendingGroupInvitations(group)).invitations[0]!.id).toBe(pending[0]!.id);
  await expect(api.respondGroupInvitation(pending[0]!.id, 'accepted')).rejects.toMatchObject({
    status: 404,
  });
  resolveMockGroupInvitation('mock-cam', pending[0]!.id, 'accepted');
  expect(mockGetGroup(group)!.members.some((m) => m.userId === 'mock-cam')).toBe(true);
});
test('recipient sees group/inviter names without gaining group/ideas access; accepts once', async () => {
  const invite = (await api.listGroupInvitations()).invitations[0]!;
  expect(invite).toMatchObject({ groupName: 'Weekend crew', inviterName: 'Ava', groupId: weekend });
  expect(mockGetGroup(weekend)).toBeNull();
  await expect(api.listGroupIdeas(weekend)).rejects.toMatchObject({ status: 404 });
  const accepted = await api.respondGroupInvitation(invite.id, 'accepted');
  expect(accepted.status).toBe('accepted');
  expect(accepted.resolvedAt).not.toBeNull();
  expect(await api.respondGroupInvitation(invite.id, 'accepted')).toEqual(accepted);
  expect(mockGetGroup(weekend)!.members.filter((m) => m.userId === MOCK_USER_ID)).toHaveLength(1);
  expect((await api.listGroupInvitations()).invitations).toEqual([]);
  expect(mockNotifications.find((n) => n.payload.inviteId === invite.id)?.readAt).not.toBeNull();
  await expect(api.respondGroupInvitation(invite.id, 'declined')).rejects.toMatchObject({
    status: 409,
  });
});
test('decline closes invite, never adds membership; duplicate decline safe and accept rejected', async () => {
  const i = (await api.listGroupInvitations()).invitations[0]!;
  const declined = await api.respondGroupInvitation(i.id, 'declined');
  expect(declined.status).toBe('declined');
  expect(mockGetGroup(weekend)).toBeNull();
  expect(await api.respondGroupInvitation(i.id, 'declined')).toEqual(declined);
  await expect(api.respondGroupInvitation(i.id, 'accepted')).rejects.toMatchObject({ status: 409 });
});
test('resolved accepted invite cannot re-add a user after leaving', async () => {
  const i = (await api.listGroupInvitations()).invitations[0]!;
  await api.respondGroupInvitation(i.id, 'accepted');
  await api.leaveGroup(weekend);
  await expect(api.respondGroupInvitation(i.id, 'accepted')).rejects.toMatchObject({ status: 409 });
  expect(mockGetGroup(weekend)).toBeNull();
});
test.each(['block', 'removeFriend'] as const)(
  '%s invalidates pending access and acceptance',
  async (action) => {
    const i = (await api.listGroupInvitations()).invitations[0]!;
    if (action === 'block') await api.blockUser('mock-ava');
    else await api.removeFriend('mock-ava');
    expect((await api.listGroupInvitations()).invitations).toEqual([]);
    await expect(api.respondGroupInvitation(i.id, 'accepted')).rejects.toMatchObject({
      status: 404,
    });
    expect(mockGetGroup(weekend)).toBeNull();
  },
);
test('full group rejects accept and retains pending; room enables retry', async () => {
  const i = (await api.listGroupInvitations()).invitations[0]!;
  const g = mockGroupRecord(weekend)!;
  g.memberIds.push(...Array.from({ length: 24 }, (_, n) => `fixture-${n}`));
  await expect(api.respondGroupInvitation(i.id, 'accepted')).rejects.toMatchObject({
    status: 409,
    code: 'GROUP_FULL',
  });
  expect(mockGroupInvitations.get(i.id)!.status).toBe('pending');
  g.memberIds.pop();
  await api.respondGroupInvitation(i.id, 'accepted');
  expect(g.memberIds).toHaveLength(25);
});
test('already joined through another consent path is resolved without duplicate membership', async () => {
  const i = (await api.listGroupInvitations()).invitations[0]!;
  mockGroupRecord(weekend)!.memberIds.push(MOCK_USER_ID);
  expect((await api.respondGroupInvitation(i.id, 'accepted')).status).toBe('accepted');
  expect(mockGroupRecord(weekend)!.memberIds.filter((id) => id === MOCK_USER_ID)).toHaveLength(1);
});
test('owners only see their outgoing invites; group/account deletion cascades', async () => {
  await expect(api.listPendingGroupInvitations(weekend)).rejects.toMatchObject({ status: 404 });
  await expect(api.listPendingGroupInvitations('mock-group-climbing')).rejects.toMatchObject({
    status: 403,
  });
  await api.addGroupMembers(group, ['mock-cam']);
  expect(listMockGroupInvitations(MOCK_USER_ID, group)).toHaveLength(1);
  await api.deleteGroup(group);
  expect([...mockGroupInvitations.values()].some((i) => i.groupId === group)).toBe(false);
  await api.deleteMe();
  expect(mockGroupInvitations.size).toBe(0);
});
test('anonymous and malformed decisions cannot resolve invitations', async () => {
  const anon = createApiClient({
    baseUrl: MOCK_API_BASE_URL,
    getAccessToken: async () => null,
    fetch: mockFetch,
  });
  await expect(anon.listGroupInvitations()).rejects.toMatchObject({ status: 401 });
  const response = await mockFetch(
    `${MOCK_API_BASE_URL}/group-invitations/mock-group-invite-weekend/respond`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${MOCK_ACCESS_TOKEN}` },
      body: JSON.stringify({ decision: 'yes', userId: 'mock-ava' }),
    },
  );
  expect(response.status).toBe(400);
  expect(mockGetGroup(weekend)).toBeNull();
});

test('a pending invite hidden by link membership cannot resurrect a removed member', async () => {
  await api.addGroupMembers(group, ['mock-cam']);
  const invite = (await api.listPendingGroupInvitations(group)).invitations[0]!;
  mockGroupRecord(group)!.memberIds.push('mock-cam'); // explicit link join
  expect(listMockGroupInvitations(MOCK_USER_ID, group)).toHaveLength(0);
  await api.removeGroupMember(group, 'mock-cam');
  expect(() => resolveMockGroupInvitation('mock-cam', invite.id, 'accepted')).toThrow();
  expect(mockGroupInvitations.get(invite.id)).toMatchObject({ status: 'declined' });
  expect(mockGroupRecord(group)!.memberIds).not.toContain('mock-cam');
  await api.addGroupMembers(group, ['mock-cam']);
  const fresh = (await api.listPendingGroupInvitations(group)).invitations[0]!;
  expect(fresh.id).not.toBe(invite.id);
  resolveMockGroupInvitation('mock-cam', fresh.id, 'accepted');
  expect(mockGroupRecord(group)!.memberIds).toContain('mock-cam');
});
