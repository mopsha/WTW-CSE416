import type { RecentWinnersStore } from '../_shared/api/recentWinners.ts';
import { ApiError } from '../_shared/api/errors.ts';
import { createServiceClient } from './serviceClient.ts';

export function createRecentWinnersStore(): RecentWinnersStore {
  return {
    async load(userId, pickIds) {
      // Service client requires an explicit membership predicate. Never trust a body user ID.
      // Composite FK binds winner to this Pick; no per-Pick/candidate database reads.
      const { data, error } = await createServiceClient()
        .from('pick_participants')
        .select(
          'pick:picks!inner(id,state,winner_place_id,winner:pick_candidates!picks_winner_is_candidate(place_id,snapshot))',
        )
        .eq('user_id', userId)
        .in('pick_id', pickIds)
        .eq('pick.state', 'completed');
      if (error) throw new ApiError(503, 'HISTORY_UNAVAILABLE', 'Recent winners unavailable');
      const rows = data as unknown as {
        pick: {
          id: string;
          winner_place_id: string | null;
          winner: { place_id: string; snapshot: object } | null;
        } | null;
      }[];
      return (rows ?? []).flatMap(({ pick }) =>
        pick?.winner && pick.winner_place_id === pick.winner.place_id
          ? [{ pickId: pick.id, placeId: pick.winner.place_id, snapshot: pick.winner.snapshot }]
          : [],
      );
    },
  };
}
