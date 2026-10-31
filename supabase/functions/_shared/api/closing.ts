// Closing the swiping phase: rank, decide a winner or send it to a final vote.
// Spec: docs/design.md#pick-state-machine (owner: Alan). Week 3.

import { ApiError } from './errors.ts';
import type { Notifier } from './notify.ts';
import type { LatLng } from '../domain/geo.ts';
import { canTransition, dueToClose, type PickState } from '../domain/pickState.ts';
import {
  answerFromDb,
  clearWinner,
  rankCandidates,
  type RankCandidate,
} from '../domain/ranking.ts';

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

/**
 * How long the final vote stays open once swiping closes. Stored as
 * picks.vote_deadline_at, separate from the swipe deadline (picks.deadline_at),
 * which has usually already passed by the time a vote starts.
 */
export const VOTE_WINDOW_MS = 30 * 60_000;

export interface RankingWrite {
  rows: { place_id: string; rank: number; score: number; finalist: boolean }[];
  state: 'completed' | 'final_vote';
  winnerPlaceId: string | null;
  /** Set only when state is final_vote. */
  voteDeadlineAt: string | null;
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
  /** Tells everyone in the Pick once it has closed (winner or vote). Optional in tests. */
  notifier?: Notifier;
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

/** A close attempt lost a version race while the Pick was still swiping. */
const CONFLICT = Symbol('conflict');
/** Concurrent final swipes each bump picks.version; a few reloads always catch up. */
export const MAX_CLOSE_ATTEMPTS = 3;

/**
 * swiping -> ranking -> completed | final_vote. Reused by the host-triggered
 * POST /picks/:id/close, the auto-close check after every swipe, and Josh's
 * deadline sweep. Idempotent: a call after the Pick has already closed just
 * reports the decision that already happened. A version conflict while still
 * swiping (another swipe landed between load and apply) is retried with fresh
 * answers; if it keeps losing, a system close gives up quietly (the next swipe
 * or the sweep tries again) and a host close gets a 409.
 */
export async function closePick(
  store: ClosingStore,
  pickId: string,
  actor: 'host' | 'system',
  actorUserId: string | null,
  now: Date = new Date(),
): Promise<CloseResult | null> {
  for (let attempt = 0; attempt < MAX_CLOSE_ATTEMPTS; attempt++) {
    const result = await attemptClose(store, pickId, actor, actorUserId, now);
    if (result !== CONFLICT) return result;
  }
  if (actor === 'system') return null;
  throw new ApiError(409, 'PICK_CONFLICT', 'Answers are still coming in; try closing again');
}

async function attemptClose(
  store: ClosingStore,
  pickId: string,
  actor: 'host' | 'system',
  actorUserId: string | null,
  now: Date,
): Promise<CloseResult | null | typeof CONFLICT> {
  const pick = await store.loadForClose(pickId);
  if (!pick) {
    if (actor === 'system') return null;
    throw new ApiError(404, 'PICK_NOT_FOUND', 'Pick not found');
  }
  // Authorize before anything else: pick_load_for_close has no access check, so
  // returning an already-closed result first would hand any caller the winner.
  if (actor === 'host' && actorUserId !== pick.hostId) {
    throw new ApiError(403, 'FORBIDDEN', 'Only the host can close this Pick');
  }
  if (pick.state !== 'swiping') {
    if (pick.state === 'completed' || pick.state === 'final_vote') return existingResult(pick);
    if (actor === 'system') return null;
    throw new ApiError(409, 'INVALID_PICK_STATE', `Pick is ${pick.state}`);
  }

  if (actor === 'host') {
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
      now,
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
  if (!canTransition('ranking', targetState, 'system'))
    throw new Error('Invalid ranking transition');

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
      voteDeadlineAt:
        targetState === 'final_vote'
          ? new Date(now.getTime() + VOTE_WINDOW_MS).toISOString()
          : null,
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      // Lost a race: another close won (report what it settled into), or a
      // swipe bumped the version while still swiping (retry with fresh data).
      const settled = await store.loadForClose(pickId);
      if (settled && settled.state !== 'swiping') return existingResult(settled);
      if (settled) return CONFLICT;
    }
    throw error;
  }

  // Only the closer whose write won gets here, so this runs once per Pick.
  await store.notifier?.(
    pick.participantIds,
    targetState === 'completed' ? 'winner_decided' : 'vote_needed',
    pickId,
  );
  return {
    state: targetState,
    winnerPlaceId: decision.kind === 'winner' ? decision.winner.placeId : null,
    finalists: finalistIds,
  };
}
