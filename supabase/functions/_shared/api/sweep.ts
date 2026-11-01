import { closePick, type ClosingStore } from './closing.ts';
import { ApiError } from './errors.ts';
import { closeVoteByDeadline, type VotingStore } from './voting.ts';

export type SweepPhase = 'swiping' | 'final_vote';
export interface SweepStore {
  /** IDs ordered ascending, strictly after the cursor; only deadlines <= cutoff. */
  expiredPage(phase: SweepPhase, cutoff: string, after?: string): Promise<{ id: string }[]>;
  /** Unfinished participants of swiping Picks whose deadline is in (from, until]. */
  reminderTargets?(from: string, until: string): Promise<{ pickId: string; userIds: string[] }[]>;
}

/** "You haven't finished" goes out when the deadline is this close. */
export const REMINDER_LEAD_MS = 60 * 60_000;

export function authorizeSweep(provided: string | undefined, expected: string | undefined): void {
  if (!expected) {
    throw new ApiError(503, 'SERVER_NOT_CONFIGURED', 'Deadline automation is not configured');
  }
  if (!provided || provided !== expected) {
    throw new ApiError(401, 'UNAUTHENTICATED', 'Invalid automation credentials');
  }
}

/** Selection and orchestration only; canonical closers own all lifecycle decisions. */
export async function sweepDeadlines(
  store: SweepStore,
  closingStore: ClosingStore & VotingStore,
  now: Date = new Date(),
) {
  const cutoff = now.toISOString();
  const summary = {
    swiping: { attempted: 0, processed: 0, failed: 0, queryFailed: false },
    final_vote: { attempted: 0, processed: 0, failed: 0, queryFailed: false },
  };
  const reminders = await sendReminders(store, closingStore, now);
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
  const failed =
    Object.values(summary).some((counts) => counts.failed || counts.queryFailed) ||
    reminders.queryFailed;
  return { status: failed ? ('partial_failure' as const) : ('ok' as const), ...summary, reminders };
}

/** Once per person per Pick: notify_insert's unique index drops repeats. */
async function sendReminders(store: SweepStore, closingStore: ClosingStore, now: Date) {
  const counts = { picks: 0, queryFailed: false };
  if (!store.reminderTargets || !closingStore.notifier) return counts;
  let targets: { pickId: string; userIds: string[] }[];
  try {
    targets = await store.reminderTargets(
      now.toISOString(),
      new Date(now.getTime() + REMINDER_LEAD_MS).toISOString(),
    );
  } catch {
    counts.queryFailed = true;
    return counts;
  }
  for (const { pickId, userIds } of targets) {
    await closingStore.notifier(userIds, 'reminder', pickId);
    counts.picks++;
  }
  return counts;
}
