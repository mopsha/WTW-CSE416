// FR-14: a plain-language reason for each finalist (Alan). Words only, never a number: users
// see rank, not scores (docs/design.md#scoring).
//
// Privacy: in a small group, counts narrow down who said what (in a group of two, "nobody
// passed" means the other person didn't say No), so groups under four get a reason based on
// rank alone.

export interface FinalistCounts {
  rank: number;
  yes: number;
  maybe: number;
  no: number;
  /** Everyone in the Pick; people who didn't answer count as Maybe in the score. */
  n: number;
}

/** Below this size, reasons say nothing about how people answered. */
export const MIN_GROUP_FOR_COUNTS = 4;

const BY_RANK = ['The group’s top match', 'A close second', 'Also in the running'] as const;

export function explainRank({ rank, yes, maybe, no, n }: FinalistCounts): string {
  if (n < MIN_GROUP_FOR_COUNTS) return BY_RANK[Math.min(Math.max(rank, 1), 3) - 1]!;
  if (no === 0 && yes === n) return 'Everyone said yes';
  if (no === 0 && yes + maybe === n) return 'Everyone said yes or maybe';
  if (no === 0) return 'Nobody passed on it';
  if (yes * 2 > n) {
    return no === 1
      ? 'Most of the group liked it; one person passed'
      : 'Most of the group liked it';
  }
  if ((yes + maybe) * 2 > n) return 'More than half the group was up for it';
  return 'No clear favorite, but it came out ahead';
}
