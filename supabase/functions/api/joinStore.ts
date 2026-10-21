import { ApiError } from '../_shared/api/errors.ts';
import type { JoinStore } from '../_shared/api/join.ts';
import { createServiceClient } from './serviceClient.ts';

/** Service-role adapter for pick_join in 0006_join_codes.sql. */
export function createJoinStore(): JoinStore {
  return {
    async joinByCode(code, userId) {
      const { data, error } = await createServiceClient().rpc('pick_join', {
        p_code: code,
        p_user_id: userId,
      });
      if (!error) return data as string;
      switch (error.code) {
        case 'PGRST202':
          throw new ApiError(503, 'DATABASE_NOT_READY', 'Join codes are not installed');
        case 'PT404':
          throw new ApiError(404, 'JOIN_CODE_NOT_FOUND', 'That code is not valid or has expired');
        case 'PT409':
          throw new ApiError(409, 'PICK_CLOSED', 'This Pick is no longer accepting people');
        case 'PT403':
          throw new ApiError(403, 'FORBIDDEN', 'Your account is not ready yet; try again');
        default:
          throw new Error('Database operation failed');
      }
    },
  };
}
