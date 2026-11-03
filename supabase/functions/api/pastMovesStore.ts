import { ApiError } from '../_shared/api/errors.ts';
import type { PastMovesStore, PastMovesResult } from '../_shared/api/pastMoves.ts';
import { createServiceClient } from './serviceClient.ts';
export function createPastMovesStore(): PastMovesStore {
  return {
    async list(viewer, target, groupId) {
      const { data, error } = await createServiceClient().rpc('profile_past_moves', {
        p_viewer_id: viewer,
        p_target_id: target,
        p_group_id: groupId,
      });
      if (error) {
        if (error.code === 'PT404')
          throw new ApiError(404, 'NOT_FOUND', 'Profile or group not found');
        if (error.code === 'PGRST202')
          throw new ApiError(503, 'DATABASE_NOT_READY', 'Past Moves are not installed');
        throw new Error('Past Moves could not be loaded');
      }
      return data as PastMovesResult;
    },
  };
}
