import type { AvailabilityStore } from '../_shared/api/availability.ts';
import { ApiError, type ErrorStatus } from '../_shared/api/errors.ts';
import { createServiceClient } from './serviceClient.ts';
export function createAvailabilityStore(): AvailabilityStore {
  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await createServiceClient().rpc(name, args);
    if (error) {
      const statuses: Record<string, ErrorStatus> = {
        PT400: 400,
        PT403: 403,
        PT404: 404,
        PT409: 409,
      };
      const status: ErrorStatus = statuses[error.code] ?? 503;
      throw new ApiError(
        status,
        'AVAILABILITY_CONFLICT',
        status === 404
          ? 'This Pick isn’t available anymore.'
          : status === 403
            ? 'You can’t do that in this Pick.'
            : status === 503
              ? 'Availability unavailable'
              : error.message,
      );
    }
    return data as T;
  }
  const args = (pickId: string, userId: string) => ({ p_pick_id: pickId, p_user_id: userId });
  return {
    load: (p, u) => rpc('pick_availability_load', args(p, u)),
    respond: async (p, u, revision, response) => {
      await rpc('pick_availability_respond', {
        ...args(p, u),
        p_revision: revision,
        p_response: response,
      });
    },
    changeTime: async (p, u, revision, proposedAt) => {
      await rpc('pick_availability_time', {
        ...args(p, u),
        p_revision: revision,
        p_proposed_at: proposedAt,
      });
    },
    claim: (p, u) => rpc('pick_availability_claim', args(p, u)),
    finish: async (p, u, token, candidates) => {
      await rpc('pick_availability_finish', {
        ...args(p, u),
        p_token: token,
        p_candidates: candidates,
      });
    },
    abort: async (p, u, token) => {
      await rpc('pick_availability_abort', { ...args(p, u), p_token: token });
    },
  };
}
