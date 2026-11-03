/** Same delay as the existing Did you go UI, independent of whether an answer exists. */
export function attendanceDue(
  planAt: string | null,
  decidedAt: string | null,
  now = Date.now(),
): boolean {
  const time = planAt ?? decidedAt;
  return (
    time !== null &&
    Number.isFinite(Date.parse(time)) &&
    now >= Date.parse(time) + (planAt ? 60 * 60_000 : 3 * 60 * 60_000)
  );
}
export function isPastMove(
  state: string,
  planAt: string | null,
  decidedAt: string | null,
  went: boolean | undefined,
  now = Date.now(),
): boolean {
  return state === 'completed' && went === true && attendanceDue(planAt, decidedAt, now);
}
/** Frozen content only; never hydrate Google display content for a memory. */
export function pastMoveWinner(
  placeId: string,
  snapshot: Record<string, unknown>,
  source?: string,
) {
  const restricted =
    source === 'google' || snapshot.provider === 'google' || snapshot.retention === 'request';
  return {
    placeId,
    name: restricted ? null : typeof snapshot.name === 'string' ? snapshot.name : null,
    locationText: restricted
      ? null
      : typeof snapshot.address === 'string'
        ? snapshot.address
        : null,
    origin: (snapshot.origin === 'group_idea'
      ? 'group_idea'
      : source === 'custom' || snapshot.provider === 'custom'
        ? 'custom'
        : 'place') as 'group_idea' | 'custom' | 'place',
  };
}
