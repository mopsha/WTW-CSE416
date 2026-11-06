import { changeHangDate, hangPlanInput, hangTimeProblem } from '@/lib/hangPlan';

test('date editing preserves the local clock, including month and year boundaries', () => {
  const before = new Date(2026, 11, 31, 23, 45);
  const after = changeHangDate(before, new Date(2027, 0, 1), 'date');
  expect([
    after.getFullYear(),
    after.getMonth(),
    after.getDate(),
    after.getHours(),
    after.getMinutes(),
  ]).toEqual([2027, 0, 1, 23, 45]);
  expect(before.getFullYear()).toBe(2026);
});
test('time editing preserves local date and serializes offsets without assuming UTC', () => {
  const start = changeHangDate(new Date(2026, 6, 5, 12), new Date(2026, 0, 1, 23, 30), 'time');
  const now = new Date(2026, 6, 5, 10).getTime();
  const input = hangPlanInput('Movie night', start, 'all_friends', now);
  expect(Date.parse(input.startsAt)).toBe(start.getTime());
  expect([start.getMonth(), start.getDate(), start.getHours()]).toEqual([6, 5, 23]);
  expect(Date.parse(input.expiresAt) - Date.parse(input.startsAt)).toBe(4 * 3600000);
});
test('the seven-day horizon is inclusive and invalid dates fail closed', () => {
  const now = new Date(2026, 0, 15, 12).getTime();
  expect(hangTimeProblem(new Date(now + 7 * 86400000), now)).toBeNull();
  expect(hangTimeProblem(new Date(now + 7 * 86400000 + 1), now)).not.toBeNull();
  expect(hangTimeProblem(new Date(now), now)).not.toBeNull();
  expect(hangTimeProblem(new Date(NaN), now)).not.toBeNull();
});
test('crossing a local daylight-saving boundary preserves the selected wall clock', () => {
  // Run this suite with TZ=America/New_York as well as the default environment.
  const start = changeHangDate(new Date(2026, 2, 7, 18), new Date(2026, 2, 8), 'date');
  expect([start.getDate(), start.getHours()]).toEqual([8, 18]);
  const input = hangPlanInput('Cookout', start, 'all_friends', new Date(2026, 2, 7, 12).getTime());
  expect(input.startsAt).toBe(start.toISOString());
  expect(Date.parse(input.expiresAt) - start.getTime()).toBe(4 * 3600000);
});

test.each([
  new Date(2026, 0, 15, 12, 34, 45),
  new Date(2026, 11, 31, 23, 59, 50),
  new Date(2026, 2, 1, 23, 30), // Spring-forward occurs inside the elapsed seven days.
  new Date(2026, 9, 25, 23, 30), // Fall-back occurs inside the elapsed seven days.
])('selectable final local day clamps to a valid instant: %s', (today) => {
  const now = today.getTime();
  const last = new Date(now + 7 * 86400000);
  const late = new Date(today);
  late.setHours(23, 59, 0, 0);
  const result = changeHangDate(late, last, 'date', now);
  expect(result.getTime()).toBeLessThanOrEqual(last.getTime());
  expect(result.getTime()).toBeGreaterThan(now);
  expect([result.getFullYear(), result.getMonth(), result.getDate()]).toEqual([
    last.getFullYear(),
    last.getMonth(),
    last.getDate(),
  ]);
  expect(result.getTime()).toBe(
    Math.min(
      changeHangDate(late, last, 'date').getTime(),
      Math.floor(last.getTime() / 60000) * 60000,
    ),
  );
  const input = hangPlanInput('Cookout', result, 'all_friends', now);
  expect(Date.parse(input.expiresAt) - result.getTime()).toBe(4 * 3600000);
});

test('near-midnight minimum advances to the next valid minute and near-limit time stays in range', () => {
  const now = new Date(2026, 0, 15, 23, 59, 50).getTime();
  const result = changeHangDate(new Date(now), new Date(now), 'date', now);
  expect(result.getTime()).toBe(Math.floor(now / 60000) * 60000 + 60000);
  const last = new Date(now + 7 * 86400000);
  const time = changeHangDate(last, new Date(2026, 0, 1, 23, 59), 'time', now);
  expect(hangTimeProblem(time, now)).toBeNull();
});
