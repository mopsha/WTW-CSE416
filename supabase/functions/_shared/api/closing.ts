// Closing the swiping phase: rank, decide a winner or send it to a final vote.
// Spec: docs/design.md#pick-state-machine (owner: Alan). Week 3.

import { ApiError } from './errors.ts';
import type { LatLng } from '../domain/geo.ts';
import { canTransition, dueToClose, type PickState } from '../domain/pickState.ts';
import { answerFromDb, clearWinner, rankCandidates, type RankCandidate } from '../domain/ranking.ts';

export interface ClosingSnapshot {
  id: string;
  hostId: string;
  state: PickState;
  center: LatLng;
  closeThreshold: number;
  deadlineAt: string | null;
  participantIds: string[];
  candidates: RankCandidate[];
  preferences: { userId: string; placeId: string; value: 0 | 1 | 2 }[];
  version: string;
  winnerPlaceId: string | null;
  /** Finalist place ids already stored, in rank order; empty before a close has happened. */
  finalistIds: string[];
}

export interface RankingWrite {
  rows: { place_id: string; rank: number; score: number; finalist: boolean }[];
  state: 'completed' | 'final_vote';
  winnerPlaceId: string | null;
}

export interface CloseResult {
  state: 'completed' | 'final_vote';
  winnerPlaceId: string | null;
  finalists: string[];
}

/** Database adapter; mutations must recheck authorization/state atomically. */
export interface ClosingStore {
  loadForClose(pickId: string): Promise<ClosingSnapshot | null>;
  applyClose(
    pickId: string,
    version: string,
    actor: 'host' | 'system',
    actorUserId: string | null,
    ranking: RankingWrite,
  ): Promise<void>;
}

function countAnswers(pick: ClosingSnapshot, userId: string): number {
  return pick.preferences.filter((p) => p.userId === userId).length;
}

function existingResult(pick: ClosingSnapshot): CloseResult {
  return {
    state: pick.state === 'completed' ? 'completed' : 'final_vote',
    winnerPlaceId: pick.winnerPlaceId,
    finalists: pick.finalistIds,
  };
}

/**
 * swiping -> ranking -> completed | final_vote. Reused by the host-triggered
 * POST /picks/:id/close, the auto-close check after every swipe, and (once
 * wired) Josh's deadline sweep. Idempotent: a second call after the Pick has
 * already closed just reports the decision that already happened.
 */
export async function closePick(
  store: ClosingStore,
  pickId: string,
  actor: 'host' | 'system',
  actorUserId: string | null,
): Promise<CloseResult | null> {
  const pick = await store.loadForClose(pickId);
  if (!pick) {
    if (actor === 'system') return null;
    throw new ApiError(404, 'PICK_NOT_FOUND', 'Pick not found');
  }
  if (pick.state !== 'swiping') {
    if (pick.state === 'completed' || pick.state === 'final_vote') return existingResult(pick);
    if (actor === 'system') return null;
    throw new ApiError(409, 'INVALID_PICK_STATE', `Pick is ${pick.state}`);
  }

  if (actor === 'host') {
    if (actorUserId !== pick.hostId) {
      throw new ApiError(403, 'FORBIDDEN', 'Only the host can close this Pick');
    }
    if (!canTransition('swiping', 'ranking', 'host')) throw new Error('Invalid close transition');
  } else {
    if (!canTransition('swiping', 'ranking', 'system')) throw new Error('Invalid close transition');
    const done = pick.participantIds.filter(
      (id) => countAnswers(pick, id) >= pick.candidates.length,
    ).length;
    const due = dueToClose({
      done,
      n: pick.participantIds.length,
      thresholdPct: pick.closeThreshold,
      deadlineAt: pick.deadlineAt ? new Date(pick.deadlineAt) : null,
      now: new Date(),
    });
    if (!due) return null;
  }

  if (!pick.candidates.length) {
    if (actor === 'system') return null;
    throw new ApiError(409, 'NO_CANDIDATES', 'Pick has no candidates');
  }

  const ranked = rankCandidates(
    pick.candidates,
    pick.preferences.map((p) => ({ placeId: p.placeId, answer: answerFromDb(p.value) })),
    pick.participantIds.length,
    pick.center,
  );
  const decision = clearWinner(ranked);
  const finalistIds = decision.kind === 'vote' ? decision.finalists.map((c) => c.placeId) : [];
  const targetState = decision.kind === 'winner' ? 'completed' : 'final_vote';
  if (!canTransition('ranking', targetState, 'system')) throw new Error('Invalid ranking transition');

  try {
    await store.applyClose(pickId, pick.version, actor, actorUserId, {
      rows: ranked.map((c) => ({
        place_id: c.placeId,
        rank: c.rank,
        score: c.score,
        finalist: finalistIds.includes(c.placeId),
      })),
      state: targetState,
      winnerPlaceId: decision.kind === 'winner' ? decision.winner.placeId : null,
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      // Lost a race with another close call (host click vs. the threshold
      // check, or a retried deadline sweep); report what it settled into.
      const settled = await store.loadForClose(pickId);
      if (settled && settled.state !== 'swiping') return existingResult(settled);
    }
    throw error;
  }

  return {
    state: targetState,
    winnerPlaceId: decision.kind === 'winner' ? decision.winner.placeId : null,
    finalists: finalistIds,
  };
}
