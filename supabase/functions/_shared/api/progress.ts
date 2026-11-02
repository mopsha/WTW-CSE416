// GET /picks/:id/progress: who's in, who's done swiping, who has voted. Counts only: never
// what anyone answered or voted for. The app's live screens poll this when Realtime is down
// (src/hooks/usePickLive.ts). Owner: Mike. Week 3.

import { ApiError } from './errors.ts';
import type { PickState } from '../domain/pickState.ts';

export interface ProgressSnapshot {
  state: PickState;
  /** Null once the host deleted their account (0017); such a Pick is completed or canceled. */
  hostId: string | null;
  deadlineAt: string | null;
  /** picks.vote_deadline_at (0004): when the final vote closes; null outside final_vote. */
  voteDeadlineAt: string | null;
  candidateCount: number;
  participants: {
    userId: string;
    displayName: string | null;
    joinedAt: string;
    /** How many candidates they've answered (a count, not the answers). */
    answered: number;
    voted: boolean;
  }[];
}

/** Database adapter (service role). Reads only. */
export interface ProgressStore {
  loadProgress(pickId: string): Promise<ProgressSnapshot | null>;
}

export interface ParticipantProgress {
  userId: string;
  displayName: string;
  isHost: boolean;
  isMe: boolean;
  done: boolean;
  voted: boolean;
}

export interface PickProgress {
  state: PickState;
  /** The deadline that matters now: swiping's in swiping, the vote's in final_vote. */
  deadlineAt: string | null;
  participants: ParticipantProgress[];
  doneCount: number;
  votedCount: number;
  total: number;
  /** The host deleted their account: show them as DELETED_USER_NAME. */
  hostDeleted: boolean;
}

/** Shape the snapshot for one caller: host first, then by join time. */
export function toProgress(snapshot: ProgressSnapshot, userId: string): PickProgress {
  const participants = [...snapshot.participants]
    .sort(
      (a, b) =>
        Number(b.userId === snapshot.hostId) - Number(a.userId === snapshot.hostId) ||
        a.joinedAt.localeCompare(b.joinedAt) ||
        a.userId.localeCompare(b.userId),
    )
    .map((p) => ({
      userId: p.userId,
      displayName: p.displayName?.trim() || 'Someone',
      isHost: p.userId === snapshot.hostId,
      isMe: p.userId === userId,
      done: snapshot.candidateCount > 0 && p.answered >= snapshot.candidateCount,
      voted: p.voted,
    }));
  return {
    state: snapshot.state,
    // The swipe deadline has usually passed by the time a vote starts; count down the vote's.
    deadlineAt: snapshot.state === 'final_vote' ? snapshot.voteDeadlineAt : snapshot.deadlineAt,
    participants,
    doneCount: participants.filter((p) => p.done).length,
    votedCount: participants.filter((p) => p.voted).length,
    total: participants.length,
    hostDeleted: snapshot.hostId === null,
  };
}

export async function getProgress(
  store: ProgressStore,
  pickId: string,
  userId: string,
): Promise<PickProgress> {
  const snapshot = await store.loadProgress(pickId);
  if (!snapshot) throw new ApiError(404, 'PICK_NOT_FOUND', 'Pick not found');
  // Same rule as GET /picks/:id: strangers learn nothing, not even who's in.
  if (!snapshot.participants.some((p) => p.userId === userId)) {
    throw new ApiError(403, 'FORBIDDEN', 'You must be a participant in this Pick');
  }
  return toProgress(snapshot, userId);
}
