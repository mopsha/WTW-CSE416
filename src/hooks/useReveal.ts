import { useCallback, useEffect, useState } from 'react';

import { api } from '@/lib/api';
import { messageOf } from '@/lib/errors';
import { queries } from '@/lib/queries';
import type { Candidate, PickDetail, PickState, RankedPlace } from '@/lib/types';

export type Reveal =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      pick: PickDetail;
      places: ReadonlyMap<string, Candidate>;
      /** By rank. Rank + finalist only; scores never reach the app. */
      ranking: RankedPlace[];
      myVote: string | null;
    };

/**
 * What the results / vote / winner screens show: the Pick (winner, decided_by), its places,
 * the stored ranking, and my ballot. Re-reads whenever the live state changes.
 */
export function useReveal(pickId: string, userId: string, state: PickState | null) {
  const [reveal, setReveal] = useState<Reveal>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.getPick(pickId),
      queries.getRankingResults(pickId),
      queries.getMyVote(pickId, userId).catch(() => null),
    ]).then(
      ([pick, ranking, myVote]) => {
        if (!active) return;
        setReveal({
          status: 'ready',
          pick,
          places: new Map(pick.candidates.map((c) => [c.placeId, c])),
          ranking: [...ranking].sort((a, b) => a.rank - b.rank),
          myVote,
        });
      },
      (e: unknown) => active && setReveal({ status: 'error', message: messageOf(e) }),
    );
    return () => {
      active = false;
    };
  }, [pickId, userId, state, attempt]);

  const retry = useCallback(() => {
    setReveal({ status: 'loading' });
    setAttempt((a) => a + 1);
  }, []);

  return { reveal, retry, setReveal };
}

/** Finalists by rank; falls back to the top three if none are flagged. */
export function finalistsOf(ranking: readonly RankedPlace[]): RankedPlace[] {
  const flagged = ranking.filter((r) => r.finalist);
  return (flagged.length ? flagged : ranking.slice(0, 3)).slice().sort((a, b) => a.rank - b.rank);
}
