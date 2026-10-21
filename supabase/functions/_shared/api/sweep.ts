import { closePick, type ClosingStore } from './closing.ts';
import { ApiError } from './errors.ts';
import { closeVoteByDeadline, type VotingStore } from './voting.ts';

export type SweepPhase = 'swiping' | 'final_vote';
export interface SweepStore {
  /** IDs ordered ascending, strictly after the cursor; only deadlines <= cutoff. */
  expiredPage(phase: SweepPhase, cutoff: string, after?: string): Promise<{ id: string }[]>;
}

export function authorizeSweep(provided: string | undefined, expected: string | undefined): void {
  if (!expected) {
    throw new ApiError(503, 'SERVER_NOT_CONFIGURED', 'Deadline automation is not configured');
  }
  if (!provided || provided !== expected) {
    throw new ApiError(401, 'UNAUTHENTICATED', 'Invalid automation credentials');
  }
}

/** Selection and orchestration only; canonical closers own all lifecycle decisions. */
export async function sweepDeadlines(store: SweepStore, closingStore: ClosingStore & VotingStore) {
  const cutoff = new Date().toISOString();
  const summary = {
    swiping: { attempted: 0, processed: 0, failed: 0, queryFailed: false },
    final_vote: { attempted: 0, processed: 0, failed: 0, queryFailed: false },
  };
  for (const phase of ['swiping', 'final_vote'] as const) {
    const counts = summary[phase];
    let after: string | undefined;
    for (;;) {
      let picks: { id: string }[];
      try {
        picks = await store.expiredPage(phase, cutoff, after);
      } catch {
        counts.queryFailed = true;
        break;
      }
      if (!picks.length) break;
      for (const { id } of picks) {
        counts.attempted++;
        try {
          if (phase === 'swiping') await closePick(closingStore, id, 'system', null);
          else await closeVoteByDeadline(closingStore, id);
          // Includes safe no-ops; this is deliberately not a count of state changes.
          counts.processed++;
        } catch {
          counts.failed++;
        }
      }
      // Keyset pagination avoids skipping rows when earlier pages close.
      after = picks[picks.length - 1]!.id;
    }
  }
  const failed = Object.values(summary).some((counts) => counts.failed || counts.queryFailed);
  return { status: failed ? ('partial_failure' as const) : ('ok' as const), ...summary };
}
