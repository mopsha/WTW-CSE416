import type { SafetyStore } from '../_shared/api/safety.ts';
import { rpcError } from './rpcErrors.ts';
import { createServiceClient } from './serviceClient.ts';

/** Service-role adapter for block_user, unblock_user, report_create, pick_set_lobby_locked (0014). */
export function createSafetyStore(): SafetyStore {
  return {
    async listBlocks(userId) {
      const client = createServiceClient();
      const { data, error } = await client
        .from('blocks')
        .select('blocked_id, created_at')
        .eq('blocker_id', userId)
        .order('created_at', { ascending: false });
      if (error) rpcError(error);
      const rows = (data ?? []) as { blocked_id: string; created_at: string }[];
      if (!rows.length) return [];
      const { data: profiles, error: profileError } = await client
        .from('profiles')
        .select('id, display_name')
        .in(
          'id',
          rows.map((r) => r.blocked_id),
        );
      if (profileError) rpcError(profileError);
      const names = new Map(
        (profiles ?? []).map((p: { id: string; display_name: string | null }) => [
          p.id,
          p.display_name,
        ]),
      );
      return rows.map((r) => ({
        userId: r.blocked_id,
        displayName: names.get(r.blocked_id) ?? null,
      }));
    },
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
