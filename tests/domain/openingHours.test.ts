import { isOpenAt, nextClosingTime, type OpeningHours } from '@shared/domain/openingHours.ts';
const schedule = (day: number, start: number, endDay: number, end: number): OpeningHours => ({
  periods: [
    { open: { day, hour: start, minute: 0 }, close: { day: endDay, hour: end, minute: 0 } },
  ],
});
const at = (s: string) => new Date(s);
const zone = 'America/New_York';

test.each([
  ['2026-10-19T12:59:59Z', false],
  ['2026-10-19T13:00:00Z', true],
  ['2026-10-19T20:59:59Z', true],
  ['2026-10-19T21:00:00Z', false],
])('regular hours and exact boundaries: %s', (date, expected) => {
  expect(isOpenAt(schedule(1, 9, 1, 17), at(date), zone)).toBe(expected);
});
test('overnight 18:00 to 02:00 and closing instant', () => {
  const hours = schedule(1, 18, 2, 2);
  expect(isOpenAt(hours, at('2026-10-20T05:00:00Z'), zone)).toBe(true);
  expect(nextClosingTime(hours, at('2026-10-20T05:00:30Z'), zone)?.toISOString()).toBe(
    '2026-10-20T06:00:00.000Z',
  );
  expect(isOpenAt(hours, at('2026-10-20T06:00:00Z'), zone)).toBe(false);
});
test('Saturday to Sunday rollover', () => {
  expect(isOpenAt(schedule(6, 18, 0, 2), at('2026-10-18T05:00:00Z'), zone)).toBe(true);
});
test('timezone converts calendar day rather than using machine timezone', () => {
  expect(isOpenAt(schedule(2, 0, 2, 2), at('2026-10-19T15:30:00Z'), 'Asia/Tokyo')).toBe(true);
  expect(isOpenAt(schedule(2, 0, 2, 2), at('2026-10-19T15:30:00Z'), 'UTC')).toBe(false);
});
test('spring DST jump preserves local closing time', () => {
  const hours = schedule(0, 0, 0, 4);
  expect(nextClosingTime(hours, at('2026-03-08T05:00:00Z'), zone)?.toISOString()).toBe(
    '2026-03-08T08:00:00.000Z',
  );
});
test('fall DST repeated hour remains open until 02:00 standard time', () => {
  const hours = schedule(0, 0, 0, 2);
  expect(isOpenAt(hours, at('2026-11-01T05:30:00Z'), zone)).toBe(true);
  expect(isOpenAt(hours, at('2026-11-01T06:30:00Z'), zone)).toBe(true);
  expect(nextClosingTime(hours, at('2026-11-01T04:00:00Z'), zone)?.toISOString()).toBe(
    '2026-11-01T07:00:00.000Z',
  );
});
test('overlapping periods do not report a false closing', () => {
  const hours = { periods: [...schedule(1, 9, 1, 12).periods, ...schedule(1, 11, 1, 17).periods] };
  expect(nextClosingTime(hours, at('2026-10-19T13:00:00Z'), zone)?.toISOString()).toBe(
    '2026-10-19T21:00:00.000Z',
  );
});
test('closed and 24/7 businesses', () => {
  const now = at('2026-10-19T13:00:00Z');
  expect(isOpenAt({ periods: [] }, now, zone)).toBe(false);
  expect(isOpenAt({ periods: [], closed: true, alwaysOpen: true }, now, zone)).toBe(false);
  expect(isOpenAt({ periods: [], alwaysOpen: true }, now, zone)).toBe(true);
  expect(nextClosingTime({ periods: [], alwaysOpen: true }, now, zone)).toBeNull();
});
test('unknown or invalid hours, dates, timezone stay unknown', () => {
  const now = new Date();
  expect(isOpenAt(null, now, zone)).toBeNull();
  expect(isOpenAt(undefined, now, zone)).toBeNull();
  expect(isOpenAt(schedule(7, 9, 1, 17), now, zone)).toBeNull();
  expect(isOpenAt(schedule(1, 9, 1, 9), now, zone)).toBeNull();
  expect(isOpenAt(schedule(1, 9, 1, 17), now, 'Invalid/Zone')).toBeNull();
  expect(isOpenAt(schedule(1, 9, 1, 17), at('invalid'), zone)).toBeNull();
  expect(nextClosingTime(null, now, zone)).toBeNull();
});
