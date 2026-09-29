import type { PickOutcome, RankDecision, RankedPlace, RankPosition } from './types';

/** Everything the Results screen can show. Rank positions only, never scores. */
export type ResultsView =
  | { kind: 'winner'; placeId: string; clearWinner: boolean }
  | { kind: 'vote'; finalists: RankPosition[] }
  | { kind: 'waiting'; reason: 'host' | 'ranking' | 'not_started' }
  | { kind: 'canceled' }
  | { kind: 'empty' };

const byRank = (a: RankPosition, b: RankPosition) => a.rank - b.rank;

/** Only the host of a Pick that is still swiping may call POST /picks/:id/rank. */
export function shouldRequestRank(outcome: PickOutcome, userId: string): boolean {
  return outcome.state === 'swiping' && outcome.hostId === userId;
}

/** What to show right after this user's POST /rank. */
export function viewFromDecision(decision: RankDecision): ResultsView {
  return decision.kind === 'winner'
    ? { kind: 'winner', placeId: decision.winner.placeId, clearWinner: true }
    : { kind: 'vote', finalists: [...decision.finalists].sort(byRank) };
}

/** What to show from stored state: the host ranked earlier, or the Pick isn't ranked yet. */
export function viewFromStored(outcome: PickOutcome, ranking: readonly RankedPlace[]): ResultsView {
  switch (outcome.state) {
    case 'draft':
      return { kind: 'waiting', reason: 'not_started' };
    case 'swiping':
      return { kind: 'waiting', reason: 'host' };
    case 'ranking':
      return { kind: 'waiting', reason: 'ranking' };
    case 'canceled':
      return { kind: 'canceled' };
    case 'completed':
    case 'final_vote': {
      if (outcome.winnerPlaceId) {
        return {
          kind: 'winner',
          placeId: outcome.winnerPlaceId,
          clearWinner: outcome.decidedBy === 'clear_winner',
        };
      }
      const sorted = [...ranking].sort(byRank);
      const finalists = sorted.filter((r) => r.finalist);
      const top = (finalists.length ? finalists : sorted.slice(0, 3)).map(({ placeId, rank }) => ({
        placeId,
        rank,
      }));
      return top.length ? { kind: 'vote', finalists: top } : { kind: 'empty' };
    }
  }
}
