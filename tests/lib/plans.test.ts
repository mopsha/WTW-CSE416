import {
  changePlanDate,
  planTimeProblem,
  formatPlanTime,
  planTimeOptions,
  shouldAskDidYouGo,
  wentSummary,
} from '@/lib/plans';

// Local times, so these pass in any time zone.
const local = (y: number, mo: number, d: number, h: number, mi = 0) =>
  new Date(y, mo - 1, d, h, mi, 0, 0);

describe('formatPlanTime', () => {
  const now = local(2026, 10, 28, 15); // a Wednesday
  test.each([
    [local(2026, 10, 28, 20), 'Today 8:00 PM'],
    [local(2026, 10, 29, 9, 30), 'Tomorrow 9:30 AM'],
    [local(2026, 10, 31, 19), 'Sat 7:00 PM'],
    [local(2026, 11, 12, 12), 'Nov 12, 12:00 PM'],
    [local(2026, 10, 28, 0, 5), 'Today 12:05 AM'],
  ])('%s', (at, label) => {
    expect(formatPlanTime(at.toISOString(), now)).toBe(label);
  });
});

describe('planTimeOptions', () => {
  test('presets remain future times across midnight and year boundaries', () => {
    for (const now of [local(2026, 10, 28, 15, 7), local(2026, 12, 31, 23, 45)]) {
      const options = planTimeOptions(now);
      expect(Date.parse(options[0]!.value) - now.getTime()).toBe(3600_000);
      expect(options.every((o) => Date.parse(o.value) > now.getTime())).toBe(true);
      expect(options.at(-1)!.label).toBe('Tomorrow at 7 PM');
      expect(new Date(options.at(-1)!.value).getHours()).toBe(19);
    }
  });
  test('tonight is offered only before 7 PM', () => {
    expect(planTimeOptions(local(2026, 10, 28, 18, 59)).map((o) => o.label)).toContain(
      'Tonight at 7 PM',
    );
    expect(planTimeOptions(local(2026, 10, 28, 19)).map((o) => o.label)).not.toContain(
      'Tonight at 7 PM',
    );
  });
});

describe('shouldAskDidYouGo', () => {
  const base = { planAt: null, myOutcome: null, myRsvp: null };
  const now = new Date('2026-10-30T12:00:00.000Z');
  test('after the plan time', () => {
    expect(shouldAskDidYouGo({ ...base, planAt: '2026-10-30T11:00:00.000Z' }, null, now)).toBe(
      true,
    );
    expect(shouldAskDidYouGo({ ...base, planAt: '2026-10-30T13:00:00.000Z' }, null, now)).toBe(
      false,
    );
    // Not as it starts: nobody should answer "Didn't happen" at 8:00 for an 8:00 plan.
    expect(shouldAskDidYouGo({ ...base, planAt: '2026-10-30T11:30:00.000Z' }, null, now)).toBe(
      false,
    );
  });
  test('3 hours after the decision when there is no time', () => {
    expect(shouldAskDidYouGo(base, '2026-10-30T08:00:00.000Z', now)).toBe(true);
    expect(shouldAskDidYouGo(base, '2026-10-30T10:00:00.000Z', now)).toBe(false);
  });
  test('not once answered, or for someone who said they cannot go', () => {
    const past = '2026-10-30T08:00:00.000Z';
    expect(shouldAskDidYouGo({ ...base, myOutcome: { went: true, again: null } }, past, now)).toBe(
      false,
    );
    expect(shouldAskDidYouGo({ ...base, myRsvp: 'not_going' }, past, now)).toBe(false);
  });
});

test('wentSummary', () => {
  expect(wentSummary({ participantCount: 4, outcomes: { went: 0, didNotGo: 0, again: 0 } })).toBe(
    null,
  );
  expect(wentSummary({ participantCount: 4, outcomes: { went: 3, didNotGo: 1, again: 2 } })).toBe(
    '3 of 4 went',
  );
});

test('custom fields preserve the other half of the local draft and enforce API bounds', () => {
  const current = local(2026, 12, 31, 18, 30);
  const date = changePlanDate(current, local(2027, 1, 2, 12), 'date');
  expect(date).toEqual(local(2027, 1, 2, 18, 30));
  expect(changePlanDate(date, local(2026, 1, 1, 20, 15), 'time')).toEqual(
    local(2027, 1, 2, 20, 15),
  );
  expect(planTimeProblem(new Date(NaN))).toBeTruthy();
  expect(planTimeProblem(current, current.getTime())).toBeTruthy();
  expect(
    planTimeProblem(new Date(current.getTime() + 31 * 86400_000), current.getTime()),
  ).toBeTruthy();
  expect(planTimeProblem(new Date(current.getTime() + 3600_000), current.getTime())).toBeNull();
});

test('tomorrow presets preserve local 7 PM across daylight-saving changes', () => {
  for (const now of [local(2026, 3, 7, 18), local(2026, 10, 31, 18)]) {
    const tomorrow = new Date(planTimeOptions(now).at(-1)!.value);
    expect(tomorrow.getHours()).toBe(19);
    expect(tomorrow.getDate()).toBe(
      new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getDate(),
    );
    expect(formatPlanTime(tomorrow.toISOString(), now)).toBe('Tomorrow 7:00 PM');
  }
});
