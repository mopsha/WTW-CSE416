import { ApiError } from '../_shared/api/errors.ts';
import { budgetedHttp } from '../_shared/places/budget.ts';
import { createServiceClient } from './serviceClient.ts';

export type LimitScope = 'create' | 'start' | 'refresh';
export async function checkUserLimit(scope: LimitScope, userId: string, pickId?: string) {
  const { data, error } = await createServiceClient().rpc('consume_user_limit', {
    p_scope: scope,
    p_user_id: userId,
    p_pick_id: pickId ?? null,
  });
  if (error) {
    if (error.code === 'PT403') throw new ApiError(403, 'FORBIDDEN', 'Only the host can do this');
    throw new ApiError(503, 'LIMITS_UNAVAILABLE', 'Usage limits unavailable');
  }
  if (data !== true) throw new ApiError(429, 'RATE_LIMITED', 'Request limit reached');
}

export const googleHttp = budgetedHttp(async () => {
  // Conservative default; 0 explicitly disables all paid calls. Invalid config fails closed.
  const cap = Number(Deno.env.get('GOOGLE_DAILY_CALL_CAP') ?? 100);
  if (!Number.isSafeInteger(cap) || cap < 0) return false;
  const { data, error } = await createServiceClient().rpc('consume_provider_call', {
    p_limit: cap,
  });
  if (error) throw new ApiError(503, 'LIMITS_UNAVAILABLE', 'Provider usage unavailable');
  return data === true;
});
