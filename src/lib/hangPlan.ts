import { parseHang, type HangInput } from '@shared/api/hang.ts';

export const HANG_START_HORIZON_MS = 7 * 86400000;
const HANG_DURATION_MS = 4 * 3600000;

/** Work in the device's local calendar; only serialize to UTC at the API boundary. */
export function changeHangDate(current: Date, selected: Date, mode: 'date' | 'time'): Date {
  const next = new Date(current);
  if (mode === 'date')
    next.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
  else next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
  return next;
}
export function hangTimeProblem(start: Date, now: number): string | null {
  if (!Number.isFinite(start.getTime()) || start.getTime() <= now)
    return 'Choose a future date and time.';
  if (start.getTime() > now + HANG_START_HORIZON_MS) return 'Choose a time within the next 7 days.';
  return null;
}
export function hangPlanInput(
  activity: string,
  start: Date,
  audience: string,
  now = Date.now(),
): HangInput {
  if (!activity.trim() || activity.trim().length > 60)
    throw new Error('Enter an activity with 1–60 characters.');
  const problem = hangTimeProblem(start, now);
  if (problem) throw new Error(problem);
  return parseHang(
    {
      activity,
      audience: audience === 'all_friends' ? 'all_friends' : 'group',
      groupId: audience === 'all_friends' ? null : audience,
      startsAt: start.toISOString(),
      expiresAt: new Date(start.getTime() + HANG_DURATION_MS).toISOString(),
    },
    new Date(now),
  );
}
