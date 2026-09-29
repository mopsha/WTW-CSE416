/**
 * Index of the first candidate at or after `from` that I haven't answered yet.
 * Returns `candidateIds.length` when everything from there on is answered (show "Rank").
 * Used on open (from = 0) to resume where I left off, and after each answer to skip
 * cards I already answered on an earlier visit.
 */
export function firstUnansweredIndex(
  candidateIds: readonly string[],
  answered: ReadonlySet<string>,
  from = 0,
): number {
  for (let i = Math.max(0, from); i < candidateIds.length; i++) {
    if (!answered.has(candidateIds[i]!)) return i;
  }
  return candidateIds.length;
}
