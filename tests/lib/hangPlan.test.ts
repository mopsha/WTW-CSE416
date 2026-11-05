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
