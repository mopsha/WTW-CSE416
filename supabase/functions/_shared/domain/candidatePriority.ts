import type { Candidate } from '../places/types.ts';
/** First representation wins, so saved/custom metadata is not overwritten by providers. */
export function priorityCandidates<T extends Pick<Candidate, 'placeId'>>(
  priority: T[],
  found: T[],
  limit: number,
): T[] {
  const unique = new Map<string, T>();
  for (const candidate of [...priority, ...found])
    if (!unique.has(candidate.placeId)) unique.set(candidate.placeId, candidate);
  return [...unique.values()].slice(0, limit);
}
