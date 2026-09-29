import { ApiError, type ErrorStatus } from '../_shared/api/errors.ts';
import type { HeartbeatStore, PickSnapshot } from '../_shared/api/heartbeat.ts';
import { createServiceClient } from './serviceClient.ts';

/** Service-role adapter for the transactional RPCs in 0002_heartbeat_rpcs.sql. */
export function createStore(): HeartbeatStore {
  async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await createServiceClient().rpc(name, args);
    if (error) {
      if (error.code === 'PGRST202') {
        throw new ApiError(
          503,
          'DATABASE_NOT_READY',
          'Heartbeat database integration is not installed',
        );
      }
      const statuses: Record<string, ErrorStatus> = {
        PT400: 400,
        PT403: 403,
        PT404: 404,
        PT409: 409,
      };
      const status = statuses[error.code];
      if (status) {
        const messages = {
          400: 'Invalid candidate',
          403: 'Pick access denied',
          404: 'Pick not found',
          409: 'Pick changed; reload before trying again',
        };
        throw new ApiError(
          status,
          status === 409 ? 'PICK_CONFLICT' : 'PICK_ACCESS_ERROR',
          messages[status as keyof typeof messages],
        );
      }
      throw new Error('Database operation failed');
    }
    return data;
  }
  return {
    async loadPick(pickId, userId) {
      return (await rpc('heartbeat_load_pick', {
        p_pick_id: pickId,
        p_user_id: userId,
      })) as PickSnapshot | null;
    },
    async upsertSwipe(pickId, userId, input) {
      await rpc('heartbeat_upsert_swipe', {
        p_pick_id: pickId,
        p_user_id: userId,
        p_place_id: input.placeId,
        p_value: input.value,
      });
    },
    async saveRanking(pickId, userId, version, ranking) {
      await rpc('heartbeat_save_ranking', {
        p_pick_id: pickId,
        p_user_id: userId,
        p_version: version,
        p_ranking: ranking,
      });
    },
  };
}
