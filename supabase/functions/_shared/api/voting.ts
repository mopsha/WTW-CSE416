// The final vote: one changeable ballot per participant among the
// finalists. Spec: docs/design.md#pick-state-machine (owner: Alan). Week 3.

import { ApiError } from './errors.ts';
import type { PickState } from '../domain/pickState.ts';
import { voteWinner, type VoteFinalist } from '../domain/ranking.ts';

export interface VoteSnapshot {
  id: string;
  hostId: string;
  state: PickState;
  participantIds: string[];
  finalists: VoteFinalist[];
  ballots: { userId: string; placeId: string }[];
  /** picks.vote_deadline_at, set by closePick when the Pick enters final_vote. */
  voteDeadlineAt: string | null;
}

/** Database adapter; mutations must recheck authorization/state atomically. */
export interface VotingStore {
  loadForVote(pickId: string): Promise<VoteSnapshot | null>;
  castVote(pickId: string, userId: string, placeId: string): Promise<void>;
  /** Silently a no-op if the vote already settled (host/everyone-voted/deadline raced). */
  applyVoteClose(pickId: string, winnerPlaceId: string): Promise<void>;
}

export function parseVote(body: unknown): string {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ApiError(400, 'INVALID_INPUT', 'Expected a vote object');
  }
  const { placeId } = body as Record<string, unknown>;
  if (typeof placeId !== 'string' || !placeId.trim() || placeId.length > 256) {
    throw new ApiError(400, 'INVALID_INPUT', 'Expected a placeId');
  }
  return placeId;
}

async function settleVote(store: VotingStore, pickId: string, snapshot: VoteSnapshot) {
  const winner = voteWinner(
    snapshot.finalists,
    snapshot.ballots.map((b) => b.placeId),
  );
  await store.applyVoteClose(pickId, winner.placeId);
}

export async function castVote(store: VotingStore, pickId: string, userId: string, body: unknown) {
  const placeId = parseVote(body);
  const pick = await store.loadForVote(pickId);
  if (!pick) throw new ApiError(404, 'PICK_NOT_FOUND', 'Pick not found');
  if (!pick.participantIds.includes(userId)) {
    throw new ApiError(403, 'FORBIDDEN', 'You must be a participant in this Pick');
  }
  if (pick.state !== 'final_vote') {
    throw new ApiError(409, 'INVALID_PICK_STATE', 'Voting is not open for this Pick');
  }
  if (!pick.finalists.some((f) => f.placeId === placeId)) {
    throw new ApiError(400, 'INVALID_CANDIDATE', 'You can only vote for a finalist');
  }

  await store.castVote(pickId, userId, placeId);

  const after = await store.loadForVote(pickId);
  if (after && after.state === 'final_vote' && after.ballots.length >= after.participantIds.length) {
    await settleVote(store, pickId, after);
  }
  return { status: 'ok' as const };
}

/** POST /picks/:id/close-vote: the host forces a tally before everyone has voted. */
export async function closeVote(store: VotingStore, pickId: string, userId: string) {
  const pick = await store.loadForVote(pickId);
  if (!pick) throw new ApiError(404, 'PICK_NOT_FOUND', 'Pick not found');
  if (userId !== pick.hostId) throw new ApiError(403, 'FORBIDDEN', 'Only the host can close the vote');
  if (pick.state !== 'final_vote') {
    if (pick.state === 'completed') return { status: 'ok' as const };
    throw new ApiError(409, 'INVALID_PICK_STATE', 'Voting is not open for this Pick');
  }
  await settleVote(store, pickId, pick);
  return { status: 'ok' as const };
}

/**
 * Called by Josh's deadline sweep. Rechecks vote_deadline_at itself, so a sweep
 * that picks up a Pick early (or a stale query) is a no-op, never an early close.
 */
export async function closeVoteByDeadline(
  store: VotingStore,
  pickId: string,
  now: Date = new Date(),
) {
  const pick = await store.loadForVote(pickId);
  if (!pick || pick.state !== 'final_vote' || !pick.voteDeadlineAt) return;
  if (now.getTime() < Date.parse(pick.voteDeadlineAt)) return;
  await settleVote(store, pickId, pick);
}
