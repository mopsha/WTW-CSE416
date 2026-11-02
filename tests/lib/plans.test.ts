import { formatPlanTime, planTimeOptions, shouldAskDidYouGo, wentSummary } from '@/lib/plans';

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
  test('all in the future, earliest first, rounded to 15 minutes', () => {
    const now = local(2026, 10, 28, 15, 7);
    const options = planTimeOptions(now);
    expect(options.map((o) => o.label)).toEqual([
      'In about an hour',
      'Tonight 8 PM',
      'Tomorrow 7 PM',
      'Saturday 7 PM',
    ]);
    const times = options.map((o) => Date.parse(o.value));
    expect(times.every((t) => t > now.getTime())).toBe(true);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(new Date(options[0]!.value).getMinutes() % 15).toBe(0);
  });

  test('late in the evening, and on Friday, the presets that no longer make sense drop out', () => {
    const friday = local(2026, 10, 30, 19, 30);
    expect(planTimeOptions(friday).map((o) => o.label)).toEqual([
      'In about an hour',
      'Tomorrow 7 PM',
    ]);
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
