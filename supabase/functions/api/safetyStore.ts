import type { SafetyStore } from '../_shared/api/safety.ts';
import { rpcError } from './rpcErrors.ts';
import { createServiceClient } from './serviceClient.ts';

/** Service-role adapter for block_user, unblock_user, report_create, pick_set_lobby_locked (0014). */
export function createSafetyStore(): SafetyStore {
  return {
    async block(userId, targetId) {
      const { error } = await createServiceClient().rpc('block_user', {
        p_user_id: userId,
        p_target_id: targetId,
      });
      if (error) rpcError(error, 'User not found');
    },
    async unblock(userId, targetId) {
      const { error } = await createServiceClient().rpc('unblock_user', {
        p_user_id: userId,
        p_target_id: targetId,
      });
      if (error) rpcError(error);
    },
    async report(userId, input) {
      const { error } = await createServiceClient().rpc('report_create', {
        p_user_id: userId,
        p_kind: input.kind,
        p_target_id: input.targetId,
        p_reason: input.reason,
      });
      if (error) rpcError(error, 'Nothing to report here');
    },
    async setLobbyLocked(pickId, userId, locked) {
      const { data, error } = await createServiceClient().rpc('pick_set_lobby_locked', {
        p_pick_id: pickId,
        p_user_id: userId,
        p_locked: locked,
      });
      if (error) rpcError(error, 'Pick not found');
      return data as boolean;
    },
  };
}
