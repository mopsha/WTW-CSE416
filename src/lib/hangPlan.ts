import 'react-native-get-random-values';
import { USE_MOCK } from './config';
import { HANG_RSVP_WINDOW_MS, parseHang, type HangInput } from '@shared/api/hang.ts';

export const HANG_START_HORIZON_MS = 7 * 86400000;

/** Work in the device's local calendar; only serialize to UTC at the API boundary. */
export function changeHangDate(
  current: Date,
  selected: Date,
  mode: 'date' | 'time',
  now?: number,
): Date {
  const sameDay =
    current.getFullYear() === selected.getFullYear() &&
    current.getMonth() === selected.getMonth() &&
    current.getDate() === selected.getDate();
  const sameClock =
    current.getHours() === selected.getHours() && current.getMinutes() === selected.getMinutes();
  const exact = mode === 'date' ? sameClock : sameDay;
  const next = new Date(exact ? selected : current);
  if (!exact && mode === 'date')
    next.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
  if (!exact && mode === 'time') next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
  if (now !== undefined) {
    const last = new Date(now + HANG_START_HORIZON_MS);
    const day = (date: Date) =>
      new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    // Keep invalid/out-of-range dates subject to validation. Within selectable local
    // dates, retain the clock when possible, otherwise choose a valid picker minute.
    if (day(next) >= day(new Date(now)) && day(next) <= day(last)) {
      const firstMinute = Math.floor(now / 60000) * 60000 + 60000;
      const lastMinute = Math.floor(last.getTime() / 60000) * 60000;
      return new Date(Math.max(firstMinute, Math.min(next.getTime(), lastMinute)));
    }
  }
  return next;
}
export function hangTimeProblem(start: Date, now: number): string | null {
  if (!Number.isFinite(start.getTime()) || start.getTime() <= now)
    return 'Choose a future date and time.';
  if (start.getTime() > now + HANG_START_HORIZON_MS) return 'Choose a time within the next 7 days.';
  return null;
}
interface HangAudience {
  allFriends: boolean;
  groupIds: string[];
  friendIds: string[];
}

export function hangPlanInput(
  activity: string,
  start: Date,
  audience: string | HangAudience,
  now = Date.now(),
  startNow = false,
): HangInput {
  if (!activity.trim() || activity.trim().length > 60)
    throw new Error('Enter an activity with 1–60 characters.');
  const resolved = startNow ? new Date(now) : start;
  const problem = startNow ? null : hangTimeProblem(resolved, now);
  if (problem) throw new Error(problem);
  const target =
    typeof audience === 'string'
      ? audience === 'all_friends'
        ? { audience: 'all_friends', groupId: null }
        : { audience: 'group', groupId: audience }
      : audience.allFriends
        ? { audience: 'all_friends', groupId: null }
        : { audience: 'selected', groupIds: audience.groupIds, friendIds: audience.friendIds };
  return parseHang(
    {
      activity,
      ...target,
      ...(typeof audience !== 'string' ? { requestId: newHangRequestId(), startNow } : {}),
      startsAt: resolved.toISOString(),
      expiresAt: new Date(resolved.getTime() + HANG_RSVP_WINDOW_MS).toISOString(),
    },
    new Date(now),
    USE_MOCK,
  );
}

function newHangRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

export type HangQuickTime = 'now' | 'tonight' | 'tomorrow' | 'custom';

/** Resolve relative choices on selection. Right now is resolved again by the server. */
export function resolveHangTime(choice: HangQuickTime, now = Date.now()): Date {
  const date = new Date(now);
  if (choice === 'now') return date;
  if (choice === 'custom') return new Date(Math.ceil((now + 3600000) / 60000) * 60000);
  if (choice === 'tomorrow') date.setDate(date.getDate() + 1);
  date.setHours(19, 0, 0, 0);
  if (choice === 'tonight' && date.getTime() <= now) {
    const latest = new Date(now);
    latest.setHours(23, 59, 0, 0);
    const soon = Math.floor(now / 60000) * 60000 + 30 * 60000;
    return new Date(Math.min(soon, latest.getTime()));
  }
  return date;
}

export function hangTimeLabel(date: Date): string {
  return date.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function hangPreview(activity: string, time: string): string {
  return `Anyone up for a hang?\n${activity.trim()} · ${time}`;
}
