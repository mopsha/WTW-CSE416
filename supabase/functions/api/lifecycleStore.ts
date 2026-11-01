import { ApiError, type ErrorStatus } from '../_shared/api/errors.ts';
import type { LifecycleStore, LifecyclePick } from '../_shared/api/lifecycle.ts';
import { createServiceClient } from './serviceClient.ts';

function mapRpcError(error: { code: string; message: string }): never {
  if (error.code === 'PGRST202') {
    throw new ApiError(
      503,
      'DATABASE_NOT_READY',
      'Pick lifecycle database integration is not installed',
    );
  }
  const statuses: Record<string, ErrorStatus> = { PT400: 400, PT403: 403, PT404: 404, PT409: 409 };
  const status = statuses[error.code];
  if (status) {
    const messages = {
      400: 'Invalid request',
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

/** Service-role adapter for the transactional RPCs in 0003_pick_lifecycle.sql. */
export function createLifecycleStore(): LifecycleStore {
  async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await createServiceClient().rpc(name, args);
    if (error) mapRpcError(error);
    return data;
  }
  return {
    async createPick(hostId, input) {
      return (await rpc('pick_create', {
        p_host_id: hostId,
        p_category: input.category,
        p_center_lat: input.center.lat,
        p_center_lng: input.center.lng,
        p_radius_m: input.radiusM,
        p_pool_size: input.poolSize,
        p_deadline_at: input.deadlineAt,
        p_close_threshold: input.closeThreshold,
      })) as { id: string };
    },
    async load(pickId, userId) {
      return (await rpc('pick_load', { p_pick_id: pickId, p_user_id: userId })) as
        | LifecyclePick
        | null;
    },
    async start(pickId, userId, candidates) {
      await rpc('pick_start', { p_pick_id: pickId, p_user_id: userId, p_candidates: candidates });
    },
    async refresh(pickId, userId, candidates) {
      await rpc('pick_refresh', {
        p_pick_id: pickId,
        p_user_id: userId,
        p_candidates: candidates,
      });
    },
    async cancel(pickId, userId, reason) {
      await rpc('pick_cancel', { p_pick_id: pickId, p_user_id: userId, p_reason: reason });
    },
  };
}
