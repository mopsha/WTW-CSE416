import { ApiError, type ErrorStatus } from '../_shared/api/errors.ts';
import type { ClosingSnapshot, ClosingStore, RankingWrite } from '../_shared/api/closing.ts';
import type { VoteSnapshot, VotingStore } from '../_shared/api/voting.ts';
import { createServiceClient } from './serviceClient.ts';

function mapRpcError(error: { code: string; message: string }): never {
  if (error.code === 'PGRST202') {
    throw new ApiError(
      503,
      'DATABASE_NOT_READY',
      'Closing/voting database integration is not installed',
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

/** Service-role adapter for the transactional RPCs in 0004_pick_close_and_vote.sql. */
export function createClosingStore(): ClosingStore & VotingStore {
  async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await createServiceClient().rpc(name, args);
    if (error) mapRpcError(error);
    return data;
  }
  return {
    async loadForClose(pickId) {
      return (await rpc('pick_load_for_close', { p_pick_id: pickId })) as ClosingSnapshot | null;
    },
    async applyClose(pickId, version, actor, actorUserId, ranking: RankingWrite) {
      await rpc('pick_close_apply', {
        p_pick_id: pickId,
        p_actor: actor,
        p_actor_user_id: actorUserId,
        p_version: version,
        p_ranking: ranking,
      });
    },
    async loadForVote(pickId) {
      return (await rpc('pick_load_for_vote', { p_pick_id: pickId })) as VoteSnapshot | null;
    },
    async castVote(pickId, userId, placeId) {
      await rpc('pick_cast_vote', { p_pick_id: pickId, p_user_id: userId, p_place_id: placeId });
    },
    async applyVoteClose(pickId, winnerPlaceId, decidedBy) {
      await rpc('pick_close_vote_apply', {
        p_pick_id: pickId,
        p_winner_place_id: winnerPlaceId,
        p_decided_by: decidedBy,
      });
    },
  };
}
