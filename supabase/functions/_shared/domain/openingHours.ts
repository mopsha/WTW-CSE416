/** Weekly local-wall-clock schedule. Sunday = 0; open inclusive, close exclusive. */
export interface HoursPoint {
  day: number;
  hour: number;
  minute: number;
}
export interface OpeningHours {
  periods: { open: HoursPoint; close: HoursPoint }[];
  alwaysOpen?: boolean;
  closed?: boolean;
}

const WEEK = 7 * 24 * 60;
function point(p: HoursPoint): number | null {
  if (
    !p ||
    !Number.isInteger(p.day) ||
    p.day < 0 ||
    p.day > 6 ||
    !Number.isInteger(p.hour) ||
    p.hour < 0 ||
    p.hour > 23 ||
    !Number.isInteger(p.minute) ||
    p.minute < 0 ||
    p.minute > 59
  )
    return null;
  return p.day * 1440 + p.hour * 60 + p.minute;
}

function evaluator(hours: OpeningHours | null | undefined, timezone: string) {
  if (!hours || !Array.isArray(hours.periods)) return null;
  const intervals: [number, number][] = [];
  for (const period of hours.periods) {
    const start = point(period?.open),
      end = point(period?.close);
    if (start === null || end === null || start === end) return null;
    intervals.push([start, end < start ? end + WEEK : end]);
  }
  let format: Intl.DateTimeFormat;
  try {
    if (!timezone) return null;
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    return null;
  }
  return (date: Date): boolean => {
    if (hours.closed) return false;
    if (hours.alwaysOpen) return true;
    const parts = Object.fromEntries(format.formatToParts(date).map((p) => [p.type, p.value]));
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday!);
    const minute = day * 1440 + Number(parts.hour) * 60 + Number(parts.minute);
    return intervals.some(
      ([start, end]) =>
        (minute >= start && minute < end) || (minute + WEEK >= start && minute + WEEK < end),
    );
  };
}

/** null means unknown, including malformed hours/timezone/date. */
export function isOpenAt(
  hours: OpeningHours | null | undefined,
  date: Date,
  timezone: string,
): boolean | null {
  if (!Number.isFinite(date.getTime())) return null;
  return evaluator(hours, timezone)?.(date) ?? null;
}

/** Next actual open→closed transition while currently open; null for unknown/closed/24h.
 * Scan UTC minute boundaries so DST gaps/repeated hours use the same wall-clock rule
 * as isOpenAt. Bounded to eight days (covers a week plus a DST offset change).
 */
export function nextClosingTime(
  hours: OpeningHours | null | undefined,
  date: Date,
  timezone: string,
): Date | null {
  if (!Number.isFinite(date.getTime())) return null;
  const open = evaluator(hours, timezone);
  if (!open || !open(date) || hours?.alwaysOpen) return null;
  const start = Math.floor(date.getTime() / 60_000) * 60_000;
  for (let i = 1; i <= 8 * 1440; i++) {
    const at = new Date(start + i * 60_000);
    if (!open(at)) return at;
  }
  return null;
}
