// The final vote: one changeable ballot per participant among the
// finalists. Spec: docs/design.md#pick-state-machine (owner: Alan). Week 3.

import { ApiError } from './errors.ts';
import type { Notifier } from './notify.ts';
import type { PickState } from '../domain/pickState.ts';
import { voteWinner, type VoteFinalist } from '../domain/ranking.ts';

export interface VoteSnapshot {
  id: string;
  hostId: string | null;
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
  /** Reports whether the winner was written, the snapshot changed, or the round closed. */
  applyVoteClose(
    pickId: string,
    winnerPlaceId: string,
    decidedBy: VoteDecidedBy,
    ballots: VoteSnapshot['ballots'],
    participantIds: string[],
  ): Promise<VoteSettlement>;
  /** Announces the winner after the database confirms settlement. */
  notifier?: Notifier;
}

/** 'tie_break' when the top vote count was shared and rank order picked the winner. */
export type VoteDecidedBy = 'vote' | 'tie_break';

export type VoteSettlement = 'committed' | 'stale' | 'closed';

/** Pure tally: the winner (voteWinner's tie chain) and whether a tie decided it. */
export function tallyVotes(
  finalists: readonly VoteFinalist[],
  ballots: readonly { placeId: string }[],
): { winnerPlaceId: string; decidedBy: VoteDecidedBy } {
  const votes = ballots.map((b) => b.placeId);
  const winner = voteWinner(finalists, votes);
  const count = (placeId: string) => votes.filter((v) => v === placeId).length;
  const top = count(winner.placeId);
  const tied = finalists.some((f) => f.placeId !== winner.placeId && count(f.placeId) === top);
  return { winnerPlaceId: winner.placeId, decidedBy: tied ? 'tie_break' : 'vote' };
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

/** How many times a tally recounts when a vote or a leave lands while it counts. The voters it
 * counted are the ones the winner notice goes to. */
const SETTLE_ATTEMPTS = 3;

async function settleVote(store: VotingStore, pickId: string, first: VoteSnapshot) {
  let snapshot: VoteSnapshot | null = first;
  for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt++) {
    // With no one left to vote there is no winner to declare; the database cancels the
    // round (0053), and 0 ballots of 0 voters must not count as everyone voting.
    if (!snapshot || snapshot.state !== 'final_vote' || !snapshot.participantIds.length) return;
    const { winnerPlaceId, decidedBy } = tallyVotes(snapshot.finalists, snapshot.ballots);
    const outcome = await store.applyVoteClose(
      pickId,
      winnerPlaceId,
      decidedBy,
      snapshot.ballots,
      snapshot.participantIds,
    );
    if (outcome !== 'stale') {
      if (outcome === 'committed') {
        await store.notifier?.(snapshot.participantIds, 'winner_decided', pickId);
      }
      return;
    }
    snapshot = await store.loadForVote(pickId);
  }
  if (!snapshot || snapshot.state !== 'final_vote' || !snapshot.participantIds.length) return;
  throw new ApiError(409, 'PICK_CONFLICT', 'Votes are still coming in. Try again in a moment.');
}

/** Settles the vote once everyone still in the Pick has voted (after a vote, or a leave). */
export async function settleIfEveryoneVoted(store: VotingStore, pickId: string) {
  const pick = await store.loadForVote(pickId);
  if (pick && pick.state === 'final_vote' && pick.ballots.length >= pick.participantIds.length)
    await settleVote(store, pickId, pick);
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
  await settleIfEveryoneVoted(store, pickId);
  return { status: 'ok' as const };
}

/** POST /picks/:id/close-vote: the host forces a tally before everyone has voted. */
export async function closeVote(store: VotingStore, pickId: string, userId: string) {
  const pick = await store.loadForVote(pickId);
  if (!pick) throw new ApiError(404, 'PICK_NOT_FOUND', 'Pick not found');
  if (userId !== pick.hostId)
    throw new ApiError(403, 'FORBIDDEN', 'Only the host can close the vote');
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
