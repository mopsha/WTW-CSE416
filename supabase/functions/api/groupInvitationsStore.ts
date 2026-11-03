import { ApiError } from '../_shared/api/errors.ts';
import type { GroupInvitation, GroupInvitationsStore } from '../_shared/api/groupInvitations.ts';
import { createServiceClient } from './serviceClient.ts';
export function createGroupInvitationsStore(): GroupInvitationsStore {
  async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await createServiceClient().rpc(name, args);
    if (error) {
      if (error.code === 'PT404')
        throw new ApiError(404, 'INVITE_NOT_FOUND', 'Invitation not found');
      if (error.code === 'PT403')
        throw new ApiError(403, 'FORBIDDEN', 'Only the group owner can view outgoing invitations');
      if (error.code === 'PT409')
        throw new ApiError(
          409,
          error.hint === 'group_full' ? 'GROUP_FULL' : 'INVITE_RESOLVED',
          error.hint === 'group_full'
            ? 'This group is full. Try again when there is room.'
            : 'This invitation is already resolved',
        );
      if (error.code === 'PT400')
        throw new ApiError(400, 'INVALID_INPUT', 'Invalid invitation decision');
      if (error.code === 'PGRST202' || error.code === 'PGRST205')
        throw new ApiError(503, 'DATABASE_NOT_READY', 'Group invitations are not installed');
      throw new Error('Group invitation database operation failed');
    }
    return data;
  }
  return {
    list: async (userId, groupId) =>
      (await rpc('group_invitations_list', {
        p_user_id: userId,
        p_group_id: groupId ?? null,
      })) as GroupInvitation[],
    resolve: async (userId, id, decision) =>
      (await rpc('group_invitation_resolve', {
        p_user_id: userId,
        p_invite_id: id,
        p_decision: decision,
      })) as GroupInvitation,
  };
}
