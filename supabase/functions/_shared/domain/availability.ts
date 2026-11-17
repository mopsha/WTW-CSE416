/** Individual decision-round availability is separate from post-result RSVP and attendance. */
export type AvailabilityResponse = 'yes' | 'maybe' | 'cant';
export const AVAILABILITY_CAPABILITY = 'availability-v2';
export interface Availability {
  proposedAt: string;
  groupName?: string | null;
  revision: number;
  locked: boolean;
  canVote: boolean;
  cohortUserIds: string[];
  eligibleUserIds?: string[];
  responseOpen?: boolean;
  deadlineMinutes: number;
  participants: {
    userId: string;
    displayName: string;
    response: AvailabilityResponse | null;
    started?: boolean;
  }[];
}
export function proposedTimeProblem(value: unknown, now = Date.now()): string | null {
  const parts =
    typeof value === 'string'
      ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.exec(
          value,
        )
      : null;
  if (!parts || typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    return 'Choose a valid outing time with a timezone.';
  const year = Number(parts[1]),
    month = Number(parts[2]),
    day = Number(parts[3]);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > new Date(Date.UTC(year, month, 0)).getUTCDate() ||
    Number(parts[4]) > 23 ||
    Number(parts[5]) > 59 ||
    Number(parts[6] ?? 0) > 59
  )
    return 'Choose a valid outing time with a timezone.';
  const at = Date.parse(value);
  if (at <= now) return 'Choose an outing time in the future.';
  // Matches existing post-result scheduling, not a new arbitrary range.
  if (at > now + 30 * 86400000) return 'Choose an outing within 30 days.';
  return null;
}
export function availabilityCounts(value: Availability) {
  const responses = value.participants.map((p) => p.response);
  return {
    yes: responses.filter((r) => r === 'yes').length,
    maybe: responses.filter((r) => r === 'maybe').length,
    cant: responses.filter((r) => r === 'cant').length,
    awaiting: responses.filter((r) => r === null).length,
  };
}
