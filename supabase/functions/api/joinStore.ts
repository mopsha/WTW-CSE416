import { ApiError } from '../_shared/api/errors.ts';
import { JOIN_CODE_NOT_FOUND, JOIN_RATE_LIMITED, type JoinStore } from '../_shared/api/join.ts';
import { createServiceClient } from './serviceClient.ts';

type JoinResult = { ok: true; pickId: string } | { ok: false; reason: 'invalid' | 'rate_limited' };

/** Service-role adapter for pick_join (0014_invites_safety.sql, which replaced 0006's). */
export function createJoinStore(): JoinStore {
  return {
    async joinByCode(code, userId) {
      const { data, error } = await createServiceClient().rpc('pick_join', {
        p_code: code,
        p_user_id: userId,
      });
      if (!error) {
        const result = data as JoinResult;
        if (result.ok) return result.pickId;
        throw result.reason === 'rate_limited' ? JOIN_RATE_LIMITED : JOIN_CODE_NOT_FOUND;
      }
      switch (error.code) {
        case 'PGRST202':
          throw new ApiError(503, 'DATABASE_NOT_READY', 'Join codes are not installed');
        case 'PT403':
          throw new ApiError(403, 'FORBIDDEN', 'Your account is not ready yet; try again');
        default:
          throw new Error('Database operation failed');
      }
    },
  };
}
