import { ApiError, parseSwipe } from './errors.ts';
import { canTransition, type PickState } from '../domain/pickState.ts';
import {
  answerFromDb,
  clearWinner,
  rankCandidates,
  type RankCandidate,
} from '../domain/ranking.ts';
import type { LatLng } from '../domain/geo.ts';

export interface PickSnapshot {
  id: string;
  hostId: string;
  state: PickState;
  center: LatLng;
  participantIds: string[];
  candidates: RankCandidate[];
  preferences: { userId: string; placeId: string; value: 0 | 1 | 2 }[];
  /** Changes whenever any ranking input or Pick state changes. */
  version: string;
}
export interface RankingWrite {
  rows: { place_id: string; rank: number; score: number; finalist: boolean }[];
  state: 'completed' | 'final_vote';
  winnerPlaceId: string | null;
}

/** Database adapter; mutations must recheck authorization/state atomically. */
export interface HeartbeatStore {
  loadPick(pickId: string, userId: string): Promise<PickSnapshot | null>;
  upsertSwipe(pickId: string, userId: string, swipe: ReturnType<typeof parseSwipe>): Promise<void>;
  saveRanking(
    pickId: string,
    userId: string,
    version: string,
    ranking: RankingWrite,
  ): Promise<void>;
}

async function participantPick(store: HeartbeatStore, pickId: string, userId: string) {
  const pick = await store.loadPick(pickId, userId);
  if (!pick) throw new ApiError(404, 'PICK_NOT_FOUND', 'Pick not found');
  if (!pick.participantIds.includes(userId)) {
    throw new ApiError(403, 'FORBIDDEN', 'You must be a participant in this Pick');
  }
  if (pick.state !== 'swiping') {
    throw new ApiError(409, 'INVALID_PICK_STATE', 'Pick must be swiping');
  }
  return pick;
}

export async function swipe(store: HeartbeatStore, pickId: string, userId: string, body: unknown) {
  const input = parseSwipe(body);
  const pick = await participantPick(store, pickId, userId);
  if (!pick.candidates.some((c) => c.placeId === input.placeId)) {
    throw new ApiError(400, 'INVALID_CANDIDATE', 'Place is not a candidate in this Pick');
  }
  await store.upsertSwipe(pickId, userId, input);
  return { status: 'ok' as const };
}

export async function rank(store: HeartbeatStore, pickId: string, userId: string) {
  const pick = await participantPick(store, pickId, userId);
  if (pick.hostId !== userId || !canTransition(pick.state, 'ranking', 'host')) {
    throw new ApiError(403, 'FORBIDDEN', 'Only the host can close swiping and rank');
  }
  if (!pick.candidates.length) throw new ApiError(409, 'NO_CANDIDATES', 'Pick has no candidates');
  const ranked = rankCandidates(
    pick.candidates,
    pick.preferences.map((p) => ({
      placeId: p.placeId,
      answer: answerFromDb(p.value),
    })),
    pick.participantIds.length,
    pick.center,
  );
  const decision = clearWinner(ranked);
  const finalists = new Set(
    decision.kind === 'vote' ? decision.finalists.map((c) => c.placeId) : [],
  );
  const state = decision.kind === 'winner' ? 'completed' : 'final_vote';
  if (!canTransition('ranking', state, 'system')) throw new Error('Invalid ranking transition');
  await store.saveRanking(pickId, userId, pick.version, {
    rows: ranked.map((c) => ({
      place_id: c.placeId,
      rank: c.rank,
      score: c.score,
      finalist: finalists.has(c.placeId),
    })),
    state,
    winnerPlaceId: decision.kind === 'winner' ? decision.winner.placeId : null,
  });
  const visible = ({ placeId, rank }: { placeId: string; rank: number }) => ({ placeId, rank });
  return {
    results: ranked.slice(0, 3).map(visible),
    decision:
      decision.kind === 'winner'
        ? { kind: 'winner' as const, winner: visible(decision.winner) }
        : { kind: 'vote' as const, finalists: decision.finalists.map(visible) },
  };
}
