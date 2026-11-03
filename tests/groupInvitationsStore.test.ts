import type { GroupInvitationsStore } from '@shared/api/groupInvitations.ts';
import { parseGroupInvitationDecision } from '@shared/api/groupInvitations.ts';
const mockRpc = jest.fn();
jest.mock('../supabase/functions/api/serviceClient.ts', () => ({
  createServiceClient: () => ({ rpc: mockRpc }),
}));
const { createGroupInvitationsStore } = jest.requireActual<{
  createGroupInvitationsStore(): GroupInvitationsStore;
}>('../supabase/functions/api/groupInvitationsStore.ts');
beforeEach(() => mockRpc.mockReset());
test('store passes authenticated identity and exact RPC arguments, not body identities', async () => {
  const store = createGroupInvitationsStore();
  mockRpc.mockResolvedValue({ data: [], error: null });
  await store.list('me');
  expect(mockRpc).toHaveBeenLastCalledWith('group_invitations_list', {
    p_user_id: 'me',
    p_group_id: null,
  });
  await store.list('owner', 'group');
  expect(mockRpc).toHaveBeenLastCalledWith('group_invitations_list', {
    p_user_id: 'owner',
    p_group_id: 'group',
  });
  await store.resolve('me', 'invite', 'accepted');
  expect(mockRpc).toHaveBeenLastCalledWith('group_invitation_resolve', {
    p_user_id: 'me',
    p_invite_id: 'invite',
    p_decision: 'accepted',
  });
});
test.each([
  ['PT404', null, 404, 'INVITE_NOT_FOUND'],
  ['PT403', null, 403, 'FORBIDDEN'],
  ['PT409', 'group_full', 409, 'GROUP_FULL'],
  ['PT409', 'invite_resolved', 409, 'INVITE_RESOLVED'],
  ['PGRST202', null, 503, 'DATABASE_NOT_READY'],
])('sanitizes %s/%s', async (code, hint, status, apiCode) => {
  mockRpc.mockResolvedValue({ data: null, error: { code, hint, message: 'SECRET internal SQL' } });
  await expect(
    createGroupInvitationsStore().resolve('me', 'invite', 'accepted'),
  ).rejects.toMatchObject({ status, code: apiCode });
  await expect(
    createGroupInvitationsStore().resolve('me', 'invite', 'accepted'),
  ).rejects.not.toThrow('SECRET');
});
test('only accepted/declined decisions are valid', () => {
  for (const decision of ['accepted', 'declined'] as const)
    expect(parseGroupInvitationDecision({ decision, userId: 'someone-else' })).toBe(decision);
  for (const body of [null, [], {}, { decision: 'pending' }, { decision: true }])
    expect(() => parseGroupInvitationDecision(body)).toThrow();
});
