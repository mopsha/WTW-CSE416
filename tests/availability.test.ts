import {
  parseCreatePick,
  startPick,
  refreshPick,
  type LifecyclePick,
  type LifecycleStore,
} from '@shared/api/lifecycle.ts';
import {
  respondAvailability,
  changeProposedTime,
  type AvailabilityStore,
} from '@shared/api/availability.ts';
import {
  proposedTimeProblem,
  availabilityCounts,
  type Availability,
} from '@shared/domain/availability.ts';
import { validateCreatePick } from '@shared/domain/createPick.ts';
import { toProgress, getProgress } from '@shared/api/progress.ts';
import { screenForState, redirectFor } from '@/lib/pickRoute';
import { ApiError } from '@shared/api/errors.ts';

const now = Date.parse('2026-11-16T12:00:00Z');
const at = '2026-11-18T19:00:00Z';
const base = {
  category: 'food' as const,
  center: { lat: 40, lng: -73 },
  radiusM: 3000,
  poolSize: 20,
  closeThreshold: 100,
  deadlineAt: null,
};
const availability = (): Availability => ({
  proposedAt: at,
  revision: 2,
  locked: false,
  canVote: false,
  cohortUserIds: [],
  deadlineMinutes: 60,
  participants: [
    { userId: 'host', displayName: 'Host', response: 'yes' },
    { userId: 'yes', displayName: 'Yes', response: 'yes' },
    { userId: 'maybe', displayName: 'Maybe', response: 'maybe' },
    { userId: 'cant', displayName: 'Cant', response: 'cant' },
    { userId: 'awaiting', displayName: 'Awaiting', response: null },
  ],
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((r, j) => {
    resolve = r;
    reject = j;
  });
  return { promise, resolve, reject };
};
function fixture() {
  const a = availability();
  const pick: LifecyclePick = {
    ...base,
    id: 'pick',
    hostId: 'host',
    state: 'draft',
    availability: a,
    participantIds: a.participants.map((p) => p.userId),
    candidates: [],
    hasAnswers: false,
    myAnswers: {},
    winnerPlaceId: null,
    decidedAt: null,
    decidedBy: null,
    version: '1',
  };
  const storeAvailability = {
    load: jest.fn().mockResolvedValue(a),
    respond: jest.fn(),
    changeTime: jest.fn(),
    claim: jest.fn().mockResolvedValue({ started: false, token: 'token' }),
    finish: jest.fn(),
    abort: jest.fn().mockResolvedValue(undefined),
  } satisfies AvailabilityStore;
  const store = {
    load: jest.fn().mockResolvedValue(pick),
    createPick: jest.fn(),
    start: jest.fn(),
    refresh: jest.fn(),
    cancel: jest.fn(),
    availability: storeAvailability,
    notifier: jest.fn(),
  } satisfies LifecycleStore;
  const pool = {
    buildPool: jest
      .fn()
      .mockResolvedValue([
        { placeId: 'cafe', name: 'Cafe', category: 'food' as const, lat: 40, lng: -73 },
      ]),
  };
  return { store, a, pick, pool };
}
beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(now));
afterEach(() => jest.restoreAllMocks());
test.each(['food', 'activities', 'both', 'custom'] as const)(
  'legacy %s payload semantics remain unchanged',
  (category) => {
    const input = {
      ...base,
      category,
      ...(category === 'custom'
        ? { customOptions: [{ name: 'Chess' }, { name: 'Cards' }], poolSize: 2 }
        : {}),
    };
    expect(validateCreatePick(input, now)).toEqual([]);
    expect(parseCreatePick(input, now)).not.toHaveProperty('proposedAt');
  },
);
test('scheduled creation uses canonical instants and deferred deadline, preserving filter and option fields', () => {
  const input = {
    ...base,
    priceMax: 2,
    includeSaved: true,
    proposedAt: '2026-11-18T14:00:00-05:00',
    swipeDeadlineMinutes: 60,
  };
  expect(validateCreatePick(input, now)).toEqual([]);
  expect(parseCreatePick(input, now)).toMatchObject({
    ...input,
    proposedAt: '2026-11-18T19:00:00.000Z',
  });
});
test.each([null, 'bad', '2026-11-18T19:00:00', '2026-11-15T19:00:00Z', '2027-01-01T00:00:00Z'])(
  'invalid or stale proposed time %s rejected',
  (proposedAt) => {
    expect(proposedTimeProblem(proposedAt, now)).not.toBeNull();
    expect(() => parseCreatePick({ ...base, proposedAt, swipeDeadlineMinutes: 60 }, now)).toThrow();
  },
);
test('deadline must leave room for final vote and must not begin at creation', () => {
  expect(() =>
    parseCreatePick(
      { ...base, proposedAt: new Date(now + 3600000).toISOString(), swipeDeadlineMinutes: 60 },
      now,
    ),
  ).toThrow(/Leave time/);
  expect(() =>
    parseCreatePick(
      {
        ...base,
        proposedAt: at,
        swipeDeadlineMinutes: 60,
        deadlineAt: new Date(now + 3600000).toISOString(),
      },
      now,
    ),
  ).toThrow(/start the swipe deadline/);
  expect(
    parseCreatePick({ ...base, proposedAt: at, swipeDeadlineMinutes: 0 }, now).deadlineAt,
  ).toBeNull();
});
test.each(['yes', 'maybe', 'cant'] as const)(
  'availability %s is written only for authenticated actor/revision',
  async (response) => {
    const { store } = fixture();
    await respondAvailability(store.availability, 'pick', 'actor', { revision: 2, response });
    expect(store.availability.respond).toHaveBeenCalledWith('pick', 'actor', 2, response);
  },
);
test.each([
  { revision: 2, response: 'yes', userId: 'other' },
  { revision: 1, response: 'invalid' },
  { revision: 0, response: 'yes' },
  { response: 'yes' },
  null,
])('invalid response body does not reach store: %j', async (body) => {
  const { store } = fixture();
  await expect(
    respondAvailability(store.availability, 'pick', 'actor', body),
  ).rejects.toMatchObject({ status: 400 });
  expect(store.availability.respond).not.toHaveBeenCalled();
});
test('retired time-edit request preserves revision and canonical timestamp but rejects an active edit', async () => {
  const { store } = fixture();
  store.availability.changeTime.mockRejectedValueOnce(
    new ApiError(409, 'FIXED_TIME', 'Fixed for this decision'),
  );
  await expect(
    changeProposedTime(store.availability, 'pick', 'host', {
      revision: 2,
      proposedAt: '2026-11-18T14:00:00-05:00',
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(store.availability.changeTime).toHaveBeenCalledWith(
    'pick',
    'host',
    2,
    '2026-11-18T19:00:00.000Z',
  );
});
test('start is server-confirmed and candidate generation is inside reservation', async () => {
  const { store, pool } = fixture();
  const pending = deferred<void>();
  store.availability.finish.mockImplementation(() => pending.promise);
  const start = startPick(store, pool, 'pick', 'host', undefined, true);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(store.start).not.toHaveBeenCalled();
  expect(store.notifier).not.toHaveBeenCalled();
  pending.resolve();
  await expect(start).resolves.toMatchObject({ state: 'swiping', candidateCount: 1 });
  expect(store.availability.claim.mock.invocationCallOrder[0]).toBeLessThan(
    pool.buildPool.mock.invocationCallOrder[0]!,
  );
  expect(store.availability.finish).toHaveBeenCalledWith(
    'pick',
    'host',
    'token',
    expect.any(Array),
  );
  expect(store.notifier).not.toHaveBeenCalled();
});
test('retry of committed start does not generate another pool or resend notifications', async () => {
  const { store, pool } = fixture();
  store.availability.claim.mockResolvedValue({ started: true, candidateCount: 20 });
  await expect(startPick(store, pool, 'pick', 'host', undefined, true)).resolves.toMatchObject({
    candidateCount: 20,
  });
  expect(pool.buildPool).not.toHaveBeenCalled();
  expect(store.notifier).not.toHaveBeenCalled();
});
test('failed generation or commit releases reservation without legacy start', async () => {
  const { store, pool } = fixture();
  pool.buildPool.mockRejectedValue(new Error('Provider unavailable'));
  await expect(startPick(store, pool, 'pick', 'host', undefined, true)).rejects.toThrow(
    'Provider unavailable',
  );
  expect(store.availability.abort).toHaveBeenCalledWith('pick', 'host', 'token');
  expect(store.availability.finish).not.toHaveBeenCalled();
  expect(store.start).not.toHaveBeenCalled();
});
test('concurrent loser cannot build a duplicate pool', async () => {
  const { store, pool } = fixture();
  const pending = deferred<void>();
  store.availability.finish.mockImplementation(() => pending.promise);
  store.availability.claim.mockRejectedValueOnce(new ApiError(409, 'BUSY', 'Starting'));
  await expect(startPick(store, pool, 'pick', 'host', undefined, true)).rejects.toMatchObject({
    status: 409,
  });
  expect(pool.buildPool).not.toHaveBeenCalled();
});
test('old client, unauthorized host and refresh cannot bypass scheduled start', async () => {
  const { store, pool } = fixture();
  await expect(startPick(store, pool, 'pick', 'host')).rejects.toMatchObject({
    code: 'UPDATE_REQUIRED',
  });
  await expect(startPick(store, pool, 'pick', 'yes', undefined, true)).rejects.toMatchObject({
    status: 403,
  });
  await expect(refreshPick(store, pool, 'pick', 'host', null)).rejects.toMatchObject({
    status: 409,
  });
  expect(pool.buildPool).not.toHaveBeenCalled();
});
test('counts distinguish no response; completion denominator uses cohort while observers can read progress', async () => {
  const a = availability();
  expect(availabilityCounts(a)).toEqual({ yes: 2, maybe: 1, cant: 1, awaiting: 1 });
  a.locked = true;
  a.cohortUserIds = ['host', 'yes', 'maybe'];
  const snapshot = {
    state: 'swiping' as const,
    hostId: 'host',
    deadlineAt: null,
    voteDeadlineAt: null,
    candidateCount: 1,
    availability: a,
    participants: a.participants.map((p) => ({
      ...p,
      joinedAt: '2026-11-16',
      answered: 1,
      voted: false,
    })),
  };
  const progress = await getProgress({ loadProgress: async () => snapshot }, 'pick', 'cant');
  expect(progress.total).toBe(3);
  expect(progress.doneCount).toBe(3);
  expect(progress.availability?.canVote).toBe(false);
  expect(toProgress({ ...snapshot, state: 'draft', candidateCount: 0 }, 'host').doneCount).toBe(0);
});
test.each(['swiping', 'ranking', 'final_vote'] as const)(
  'ineligible stale %s deep links return to lobby',
  (state) => {
    expect(screenForState(state, { canVote: false })).toBe('lobby');
    expect(redirectFor('swipe', state, { canVote: false })).toBe('lobby');
    expect(redirectFor('lobby', state, { canVote: false })).toBeNull();
  },
);
test('all authorized invitees can view completed results', () =>
  expect(screenForState('completed', { canVote: false })).toBe('winner'));

test('calendar-invalid timestamps are rejected, and DST overlap offsets retain distinct instants', () => {
  expect(proposedTimeProblem('2026-11-31T19:00:00Z', now)).not.toBeNull();
  const beforeFallback = Date.parse('2026-10-31T12:00:00Z');
  const first = parseCreatePick(
    { ...base, proposedAt: '2026-11-01T01:30:00-04:00', swipeDeadlineMinutes: 0 },
    beforeFallback,
  );
  const second = parseCreatePick(
    { ...base, proposedAt: '2026-11-01T01:30:00-05:00', swipeDeadlineMinutes: 0 },
    beforeFallback,
  );
  expect(first.proposedAt).toBe('2026-11-01T05:30:00.000Z');
  expect(second.proposedAt).toBe('2026-11-01T06:30:00.000Z');
});

test('ambiguous initialization success reconciles the committed round without aborting it', async () => {
  const { store, pool, pick } = fixture();
  store.availability.finish.mockImplementation(async () => {
    pick.state = 'swiping';
    pick.candidates = [{ placeId: 'cafe', snapshot: { name: 'Cafe', lat: 40, lng: -73 } }];
    throw new Error('Connection lost after commit');
  });
  await expect(startPick(store, pool, 'pick', 'host', undefined, true)).resolves.toEqual({
    state: 'swiping',
    candidateCount: 1,
  });
  expect(store.availability.abort).not.toHaveBeenCalled();
});
