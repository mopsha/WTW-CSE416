import { ApiError, type ErrorStatus } from '../_shared/api/errors.ts';
import type { HistoryItem, PlanSummary, PlansStore } from '../_shared/api/plans.ts';
import { createServiceClient } from './serviceClient.ts';

function mapRpcError(
  error: { code: string; message?: string },
  notFound = 'PICK_NOT_FOUND',
): never {
  if (error.code === 'PGRST202') {
    throw new ApiError(503, 'DATABASE_NOT_READY', 'Plans and history are not installed');
  }
  const known: Record<string, [ErrorStatus, string, string]> = {
    PT400: [400, 'INVALID_INPUT', 'Invalid request'],
    PT403: [403, 'FORBIDDEN', 'Only the host can do this'],
    PT404: [404, notFound, notFound === 'GROUP_NOT_FOUND' ? 'Group not found' : 'Pick not found'],
    // Our own RPC messages ("changed too many times", "still going"), safe to show.
    PT409: [409, 'INVALID_PICK_STATE', error.message || 'This Pick is not at that step'],
  };
  const hit = known[error.code];
  if (hit) throw new ApiError(...hit);
  throw new Error('Database operation failed');
}

/** Service-role adapter for 0013_plans_rsvp.sql. */
export function createPlansStore(): PlansStore {
  async function rpc(name: string, args: Record<string, unknown>, notFound?: string) {
    const { data, error } = await createServiceClient().rpc(name, args);
    if (error) mapRpcError(error, notFound);
    return data;
  }
  return {
    async setPlanTime(pickId, userId, planAt) {
      return ((await rpc('pick_set_plan_time', {
        p_pick_id: pickId,
        p_user_id: userId,
        p_plan_at: planAt,
      })) ?? []) as string[];
    },
    async rsvp(pickId, userId, status) {
      await rpc('pick_rsvp', { p_pick_id: pickId, p_user_id: userId, p_status: status });
    },
    async outcome(pickId, userId, went, again) {
      await rpc('pick_outcome', {
        p_pick_id: pickId,
        p_user_id: userId,
        p_went: went,
        p_again: again,
      });
    },
    async loadPlan(pickId, userId) {
      return (await rpc('pick_plan_load', { p_pick_id: pickId, p_user_id: userId })) as PlanSummary;
    },
    async history(userId, groupId) {
      return ((await rpc(
        'pick_history',
        { p_user_id: userId, p_group_id: groupId },
        groupId ? 'GROUP_NOT_FOUND' : undefined,
      )) ?? []) as HistoryItem[];
    },
    async again(pickId, userId) {
      return (await rpc('pick_again', { p_pick_id: pickId, p_user_id: userId })) as {
        id: string;
        addedUserIds: string[];
      };
    },
    async finalistCounts(pickId, userId) {
      const rows = ((await rpc('pick_finalist_counts', {
        p_pick_id: pickId,
        p_user_id: userId,
      })) ?? []) as {
        place_id: string;
        rank: number;
        yes: number;
        maybe: number;
        no: number;
        n: number;
      }[];
      return rows.map(({ place_id, ...counts }) => ({ placeId: place_id, ...counts }));
    },
  };
}
