import {
  getHistory,
  getReasons,
  parseOutcome,
  parsePlanTime,
  pickAgain,
  recordOutcome,
  rsvp,
  setPlanTime,
  type PlansStore,
} from '@shared/api/plans.ts';
import { sweepDeadlines, type SweepStore } from '@shared/api/sweep.ts';
import { explainRank, MIN_GROUP_FOR_COUNTS } from '@shared/domain/explainRank.ts';

describe('explainRank (FR-14)', () => {
  test('never contains a number, for every possible answer mix up to 8 people', () => {
    for (let n = 1; n <= 8; n++) {
      for (let yes = 0; yes <= n; yes++) {
        for (let maybe = 0; yes + maybe <= n; maybe++) {
          for (let no = 0; yes + maybe + no <= n; no++) {
            for (const rank of [1, 2, 3]) {
              expect(explainRank({ rank, yes, maybe, no, n })).not.toMatch(/\d/);
            }
          }
        }
      }
    }
  });

  test('groups under four get a rank-only reason, so nobody learns the other answer', () => {
    expect(MIN_GROUP_FOR_COUNTS).toBe(4);
    expect(explainRank({ rank: 1, yes: 3, maybe: 0, no: 0, n: 3 })).toBe('The group’s top match');
    const a = explainRank({ rank: 1, yes: 2, maybe: 0, no: 0, n: 2 });
    const b = explainRank({ rank: 1, yes: 0, maybe: 0, no: 2, n: 2 });
    expect(a).toBe(b);
    expect(a).toBe('The group’s top match');
    expect(explainRank({ rank: 2, yes: 1, maybe: 0, no: 1, n: 2 })).toBe('A close second');
  });

  test.each([
    [{ yes: 4, maybe: 0, no: 0 }, 'Everyone said yes'],
    [{ yes: 2, maybe: 2, no: 0 }, 'Everyone said yes or maybe'],
    [{ yes: 2, maybe: 0, no: 0 }, 'Nobody passed on it'],
    [{ yes: 3, maybe: 0, no: 1 }, 'Most of the group liked it; one person passed'],
    [{ yes: 3, maybe: 0, no: 1, n: 5 }, 'Most of the group liked it; one person passed'],
    [{ yes: 1, maybe: 2, no: 1 }, 'More than half the group was up for it'],
    [{ yes: 1, maybe: 0, no: 3 }, 'No clear favorite, but it came out ahead'],
  ])('%j -> %s', (counts, reason) => {
    expect(explainRank({ rank: 1, n: 4, ...counts })).toBe(reason);
  });
});

function store(over: Partial<PlansStore> = {}) {
  return {
    setPlanTime: jest.fn().mockResolvedValue(['guest']),
    rsvp: jest.fn().mockResolvedValue(undefined),
    outcome: jest.fn().mockResolvedValue(undefined),
    loadPlan: jest.fn(),
    history: jest.fn().mockResolvedValue([]),
    again: jest.fn().mockResolvedValue({ id: 'new', addedUserIds: ['guest', 'third'] }),
    finalistCounts: jest.fn().mockResolvedValue([]),
    notifier: jest.fn().mockResolvedValue(undefined),
    ...over,
  } satisfies PlansStore;
}

describe('plans API', () => {
  const now = Date.parse('2026-10-30T12:00:00.000Z');

  test('plan time: a future date within 30 days, normalized', () => {
    expect(parsePlanTime({ planAt: '2026-10-30T20:00:00-04:00' }, now)).toBe(
      '2026-10-31T00:00:00.000Z',
    );
    for (const body of [
      null,
      { planAt: 'tonight' },
      { planAt: '2026-10-30T11:00:00.000Z' },
      { planAt: '2026-12-15T12:00:00.000Z' },
    ]) {
      expect(() => parsePlanTime(body, now)).toThrow(expect.objectContaining({ status: 400 }));
    }
  });

  test('setting the time tells everyone else', async () => {
    const s = store();
    const planAt = new Date(Date.now() + 3_600_000).toISOString();
    expect(await setPlanTime(s, 'p1', 'host', { planAt })).toEqual({ planAt });
    expect(s.setPlanTime).toHaveBeenCalledWith('p1', 'host', planAt);
    expect(s.notifier).toHaveBeenCalledWith(['guest'], 'plan_time_set', 'p1');
  });

  test('RSVP and outcome validate before touching the database', async () => {
    const s = store();
    await rsvp(s, 'p1', 'u', { status: 'going' });
    expect(s.rsvp).toHaveBeenCalledWith('p1', 'u', 'going');
    await expect(rsvp(s, 'p1', 'u', { status: 'yes' })).rejects.toMatchObject({ status: 400 });

    expect(parseOutcome({ went: true })).toEqual({ went: true, again: null });
    expect(parseOutcome({ went: false, again: true })).toEqual({ went: false, again: true });
    for (const body of [{}, { went: 'yes' }, { went: true, again: 'maybe' }, []]) {
      await expect(recordOutcome(s, 'p1', 'u', body)).rejects.toMatchObject({ status: 400 });
    }
    expect(s.outcome).not.toHaveBeenCalled();
  });

  test('Pick again tells the people it added, with the new Pick id', async () => {
    const s = store();
    expect(await pickAgain(s, 'old', 'me')).toEqual({ pickId: 'new', state: 'draft' });
    expect(s.notifier).toHaveBeenCalledWith(['guest', 'third'], 'added_to_pick', 'new');
  });

  test('group history: a malformed group id is a 404 without a query', async () => {
    const s = store();
    await expect(getHistory(s, 'me', 'not-a-uuid')).rejects.toMatchObject({ status: 404 });
    expect(s.history).not.toHaveBeenCalled();
    await getHistory(s, 'me', '0f8fad5b-d9cb-469f-a165-70867728950e');
    expect(s.history).toHaveBeenCalledWith('me', '0f8fad5b-d9cb-469f-a165-70867728950e');
  });

  test('reasons are words built from counts', async () => {
    const s = store({
      finalistCounts: jest
        .fn()
        .mockResolvedValue([{ placeId: 'a', rank: 1, yes: 4, maybe: 0, no: 0, n: 4 }]),
    });
    expect(await getReasons(s, 'p1', 'u')).toEqual({
      reasons: [{ placeId: 'a', rank: 1, reason: 'Everyone said yes' }],
    });
  });
});

describe('plan events in the sweep', () => {
  test('sends plan reminders and "Did you go?" prompts that are due', async () => {
    const notifier = jest.fn().mockResolvedValue(undefined);
    const sweep: SweepStore = {
      expiredPage: jest.fn().mockResolvedValue([]),
      planTargets: jest.fn().mockResolvedValue([
        { pickId: 'p1', kind: 'plan_reminder', userIds: ['a'] },
        { pickId: 'p2', kind: 'did_you_go', userIds: ['b', 'c'] },
      ]),
    };
    const closingStore = {
      loadForClose: jest.fn(),
      applyClose: jest.fn(),
      loadForVote: jest.fn(),
      castVote: jest.fn(),
      applyVoteClose: jest.fn(),
      notifier,
    };
    const now = new Date('2026-10-30T12:00:00.000Z');
    const result = await sweepDeadlines(sweep, closingStore, now);
    expect(sweep.planTargets).toHaveBeenCalledWith('2026-10-30T12:00:00.000Z');
    expect(notifier).toHaveBeenCalledWith(['a'], 'plan_reminder', 'p1');
    expect(notifier).toHaveBeenCalledWith(['b', 'c'], 'did_you_go', 'p2');
    expect(result).toMatchObject({ status: 'ok', planEvents: { picks: 2 } });
  });
});
