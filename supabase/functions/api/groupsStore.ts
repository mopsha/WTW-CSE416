import { ApiError } from '../_shared/api/errors.ts';
import type { GroupSummary, GroupsStore } from '../_shared/api/groups.ts';
import { createServiceClient } from './serviceClient.ts';

// 0012_groups.sql raises PT4xx with a HINT naming the reason, so "not the owner"
// and "not your friend" (both 403) map to different API codes.
const HINTS: Record<string, ApiError> = {
  invalid_name: new ApiError(400, 'INVALID_INPUT', 'Group names are 1 to 50 characters'),
  group_not_found: new ApiError(404, 'GROUP_NOT_FOUND', 'Group not found'),
  pick_not_found: new ApiError(404, 'PICK_NOT_FOUND', 'Pick not found'),
  user_not_found: new ApiError(404, 'USER_NOT_FOUND', 'No WTW account matches that'),
  not_owner: new ApiError(403, 'FORBIDDEN', 'Only the group owner can do this'),
  not_host: new ApiError(403, 'FORBIDDEN', 'Only the host can do this'),
  not_friends: new ApiError(403, 'NOT_FRIENDS', 'You can only add your friends'),
  no_profile: new ApiError(403, 'FORBIDDEN', 'Your account is not ready yet; try again'),
  group_full: new ApiError(409, 'GROUP_FULL', 'A group can have up to 25 people'),
  owner_cannot_leave: new ApiError(
    409,
    'OWNER_CANNOT_LEAVE',
    'The owner cannot leave; delete the group instead',
  ),
  pick_closed: new ApiError(409, 'PICK_CLOSED', 'This Pick is no longer accepting people'),
};

function fail(error: { code?: string; hint?: string | null }): never {
  // PGRST202: missing RPC; PGRST205: missing table (migration not applied).
  if (error.code === 'PGRST202' || error.code === 'PGRST205') {
    throw new ApiError(503, 'DATABASE_NOT_READY', 'Groups are not installed');
  }
  const known = error.code?.startsWith('PT') && error.hint ? HINTS[error.hint] : undefined;
  if (known) throw new ApiError(known.status, known.code, known.message);
  throw new Error('Database operation failed');
}

/** Service-role adapter for the group_* / pick_add_group / pick_invite RPCs in 0012_groups.sql. */
export function createGroupsStore(): GroupsStore {
  async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await createServiceClient().rpc(name, args);
    if (error) fail(error);
    return data;
  }
  return {
    async create(userId, name) {
      return (await rpc('group_create', { p_user_id: userId, p_name: name })) as GroupSummary;
    },
    async rename(userId, groupId, name) {
      await rpc('group_rename', { p_user_id: userId, p_group_id: groupId, p_name: name });
    },
    async delete(userId, groupId) {
      await rpc('group_delete', { p_user_id: userId, p_group_id: groupId });
    },
    async addMembers(userId, groupId, userIds) {
      return (await rpc('group_add_members', {
        p_user_id: userId,
        p_group_id: groupId,
        p_user_ids: userIds,
      })) as number;
    },
    async removeMember(userId, groupId, memberId) {
      await rpc('group_remove_member', {
        p_user_id: userId,
        p_group_id: groupId,
        p_member_id: memberId,
      });
    },
    async leave(userId, groupId) {
      await rpc('group_leave', { p_user_id: userId, p_group_id: groupId });
    },
    async isMember(groupId, userId) {
      const { data, error } = await createServiceClient()
        .from('group_members')
        .select('user_id')
        .eq('group_id', groupId)
        .eq('user_id', userId)
        .maybeSingle();
      if (error) fail(error);
      return data !== null;
    },
    async addGroupToPick(pickId, userId, groupId) {
      return (await rpc('pick_add_group', {
        p_pick_id: pickId,
        p_user_id: userId,
        p_group_id: groupId,
      })) as number;
    },
    async invite(pickId, userId, userIds) {
      return (await rpc('pick_invite', {
        p_pick_id: pickId,
        p_user_id: userId,
        p_user_ids: userIds,
      })) as number;
    },
  };
}
