import { closePick, type ClosingSnapshot, type ClosingStore } from '@shared/api/closing.ts';
import { startPick, type LifecyclePick, type LifecycleStore } from '@shared/api/lifecycle.ts';
import {
  createNotifier,
  EXPO_PUSH_URL,
  listNotifications,
  markNotificationRead,
  NOTIFICATION_TYPES,
  PUSH_TEXT,
  registerPushToken,
  type NotifyStore,
} from '@shared/api/notify.ts';
import { sweepDeadlines, type SweepStore } from '@shared/api/sweep.ts';
import { castVote, type VoteSnapshot, type VotingStore } from '@shared/api/voting.ts';

const TOKEN = (i: number) => `ExponentPushToken[tok${i}]`;

function notifyStore(over: Partial<NotifyStore> = {}) {
  return {
    insert: jest.fn().mockImplementation(async (ids: string[]) => ids),
    tokensFor: jest.fn().mockResolvedValue([TOKEN(1)]),
    deleteTokens: jest.fn().mockResolvedValue(undefined),
    list: jest.fn().mockResolvedValue([]),
    markRead: jest.fn().mockResolvedValue(undefined),
    registerToken: jest.fn().mockResolvedValue(undefined),
    ...over,
  } satisfies NotifyStore;
}

const ok = (tickets: unknown[]) => new Response(JSON.stringify({ data: tickets }), { status: 200 });

describe('createNotifier', () => {
  test('writes the inbox row, then pushes generic text with ids only', async () => {
    const store = notifyStore();
    const fetchFn = jest.fn().mockResolvedValue(ok([{ status: 'ok' }]));
    await createNotifier(store, fetchFn)(['a', 'a', 'b'], 'pick_canceled', 'p1', {
      reason: 'Rained out',
    });
    expect(store.insert).toHaveBeenCalledWith(['a', 'b'], 'pick_canceled', 'p1', {
      reason: 'Rained out',
    });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(EXPO_PUSH_URL);
    const [message] = JSON.parse(init.body);
    expect(message).toEqual({
      to: TOKEN(1),
      sound: 'default',
      ...PUSH_TEXT.pick_canceled,
      data: { type: 'pick_canceled', pickId: 'p1' },
    });
    expect(init.body).not.toContain('Rained out');
  });

  test('a repeated event (no new rows) sends no push', async () => {
    const store = notifyStore({ insert: jest.fn().mockResolvedValue([]) });
    const fetchFn = jest.fn();
    await createNotifier(store, fetchFn)(['a'], 'reminder', 'p1');
    expect(store.tokensFor).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test('batches 100 tokens per request and deletes DeviceNotRegistered tokens', async () => {
    const tokens = Array.from({ length: 150 }, (_, i) => TOKEN(i));
    const store = notifyStore({ tokensFor: jest.fn().mockResolvedValue(tokens) });
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(
        ok([
          { status: 'ok' },
          { status: 'error', details: { error: 'DeviceNotRegistered' } },
          { status: 'error', details: { error: 'MessageRateExceeded' } },
        ]),
      )
      .mockResolvedValueOnce(new Response('down', { status: 500 }));
    await createNotifier(store, fetchFn)(['a'], 'winner_decided', 'p1');
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toHaveLength(100);
    expect(JSON.parse(fetchFn.mock.calls[1][1].body)).toHaveLength(50);
    expect(store.deleteTokens).toHaveBeenCalledWith([TOKEN(1)]);
  });

  test('never throws: a failing database or network is logged, not raised', async () => {
    const log = jest.fn();
    const store = notifyStore({ insert: jest.fn().mockRejectedValue(new TypeError('db down')) });
    await expect(createNotifier(store, jest.fn(), log)(['a'], 'pick_started', 'p1')).resolves.toBe(
      undefined,
    );
    expect(log).toHaveBeenCalledWith('notify failed', 'pick_started', 'TypeError');
    const offline = jest.fn().mockRejectedValue(new Error('offline'));
    await expect(createNotifier(notifyStore(), offline)(['a'], 'pick_started', 'p1')).resolves.toBe(
      undefined,
    );
  });

  test('nobody to tell does nothing', async () => {
    const store = notifyStore();
    await createNotifier(store, jest.fn())([], 'pick_started', 'p1');
    expect(store.insert).not.toHaveBeenCalled();
  });

  test('every type has push text with no placeholders for names', () => {
    for (const type of NOTIFICATION_TYPES) {
      expect(PUSH_TEXT[type].title.length).toBeGreaterThan(0);
      expect(PUSH_TEXT[type].body).not.toMatch(/\{|\$/);
    }
  });
});

describe('routes', () => {
  test('push token: valid Expo tokens on ios/android only', async () => {
    const store = notifyStore();
    await expect(
      registerPushToken(store, 'u', { token: TOKEN(1), platform: 'ios' }),
    ).resolves.toEqual({ status: 'ok' });
    expect(store.registerToken).toHaveBeenCalledWith('u', TOKEN(1), 'ios');
    for (const body of [
      null,
      { token: 'abc', platform: 'ios' },
      { token: TOKEN(1), platform: 'web' },
      { token: `ExponentPushToken[${'x'.repeat(201)}]`, platform: 'android' },
    ]) {
      await expect(registerPushToken(store, 'u', body)).rejects.toMatchObject({ status: 400 });
    }
  });

  test('inbox counts unread', async () => {
    const row = { type: 'pick_started', pickId: 'p', payload: {}, createdAt: 'x' } as const;
    const store = notifyStore({
      list: jest.fn().mockResolvedValue([
        { ...row, id: '1', readAt: null },
        { ...row, id: '2', readAt: 'y' },
      ]),
    });
    expect((await listNotifications(store, 'u')).unreadCount).toBe(1);
    expect(store.list).toHaveBeenCalledWith('u', 50);
  });

  test('mark read: a malformed id is a 404 without a query', async () => {
    const store = notifyStore();
    await expect(markNotificationRead(store, 'nope', 'u')).rejects.toMatchObject({ status: 404 });
    expect(store.markRead).not.toHaveBeenCalled();
  });
});

const closing = (over: Partial<ClosingSnapshot> = {}): ClosingSnapshot => ({
  id: 'p1',
  hostId: 'host',
  state: 'swiping',
  center: { lat: 0, lng: 0 },
  closeThreshold: 100,
  deadlineAt: null,
  participantIds: ['host', 'guest'],
  candidates: [
    { placeId: 'a', lat: 0, lng: 0 },
    { placeId: 'b', lat: 0, lng: 0 },
  ],
  preferences: [
    { userId: 'host', placeId: 'a', value: 2 },
    { userId: 'guest', placeId: 'a', value: 2 },
    { userId: 'host', placeId: 'b', value: 0 },
    { userId: 'guest', placeId: 'b', value: 0 },
  ],
  version: '1',
  winnerPlaceId: null,
  finalistIds: [],
  ...over,
});

describe('Pick events', () => {
  test('a close tells everyone once: the winner', async () => {
    const notifier = jest.fn().mockResolvedValue(undefined);
    const store: ClosingStore = {
      loadForClose: jest.fn().mockResolvedValue(closing()),
      applyClose: jest.fn().mockResolvedValue(undefined),
      notifier,
    };
    await closePick(store, 'p1', 'host', 'host');
    expect(notifier).toHaveBeenCalledTimes(1);
    expect(notifier).toHaveBeenCalledWith(['host', 'guest'], 'winner_decided', 'p1');
  });

  test('a close that goes to a vote says so', async () => {
    const notifier = jest.fn().mockResolvedValue(undefined);
    const tied = closing({
      preferences: [
        { userId: 'host', placeId: 'a', value: 2 },
        { userId: 'guest', placeId: 'b', value: 2 },
        { userId: 'host', placeId: 'b', value: 2 },
        { userId: 'guest', placeId: 'a', value: 2 },
      ],
    });
    const store: ClosingStore = {
      loadForClose: jest.fn().mockResolvedValue(tied),
      applyClose: jest.fn().mockResolvedValue(undefined),
      notifier,
    };
    await closePick(store, 'p1', 'host', 'host');
    expect(notifier).toHaveBeenCalledWith(['host', 'guest'], 'vote_needed', 'p1');
  });

  test('a close that already happened sends nothing', async () => {
    const notifier = jest.fn();
    const store: ClosingStore = {
      loadForClose: jest
        .fn()
        .mockResolvedValue(closing({ state: 'completed', winnerPlaceId: 'a' })),
      applyClose: jest.fn(),
      notifier,
    };
    await closePick(store, 'p1', 'system', null);
    expect(notifier).not.toHaveBeenCalled();
  });

  test('the last vote announces the winner', async () => {
    const notifier = jest.fn().mockResolvedValue(undefined);
    const snap: VoteSnapshot = {
      id: 'p1',
      hostId: 'host',
      state: 'final_vote',
      participantIds: ['host', 'guest'],
      finalists: [
        { placeId: 'a', rank: 1 },
        { placeId: 'b', rank: 2 },
      ],
      ballots: [{ userId: 'host', placeId: 'a' }],
      voteDeadlineAt: null,
    };
    const both = { ...snap, ballots: [...snap.ballots, { userId: 'guest', placeId: 'a' }] };
    const store: VotingStore = {
      loadForVote: jest.fn().mockResolvedValueOnce(snap).mockResolvedValueOnce(both),
      castVote: jest.fn().mockResolvedValue(undefined),
      applyVoteClose: jest.fn().mockResolvedValue(undefined),
      notifier,
    };
    await castVote(store, 'p1', 'guest', { placeId: 'a' });
    expect(notifier).toHaveBeenCalledWith(['host', 'guest'], 'winner_decided', 'p1');
  });

  test('starting tells everyone except the host', async () => {
    const notifier = jest.fn().mockResolvedValue(undefined);
    const draft = {
      id: 'p1',
      hostId: 'host',
      state: 'draft',
      category: 'food',
      center: { lat: 0, lng: 0 },
      radiusM: 1000,
      poolSize: 20,
      deadlineAt: null,
      closeThreshold: 100,
      participantIds: ['host', 'guest', 'third'],
      candidates: [],
      hasAnswers: false,
      myAnswers: {},
      winnerPlaceId: null,
      decidedAt: null,
      decidedBy: null,
      version: '1',
    } satisfies LifecyclePick;
    const store: LifecycleStore = {
      createPick: jest.fn(),
      load: jest.fn().mockResolvedValue(draft),
      start: jest.fn().mockResolvedValue(undefined),
      refresh: jest.fn(),
      cancel: jest.fn(),
      notifier,
    };
    const pool = {
      buildPool: jest.fn().mockResolvedValue([{ placeId: 'a', lat: 0, lng: 0 }]),
    };
    await startPick(store, pool, 'p1', 'host');
    expect(notifier).toHaveBeenCalledWith(['guest', 'third'], 'pick_started', 'p1');
  });
});

describe('deadline reminders in the sweep', () => {
  const now = new Date('2026-10-30T12:00:00.000Z');
  const closingStore = (notifier = jest.fn().mockResolvedValue(undefined)) => ({
    loadForClose: jest.fn(),
    applyClose: jest.fn(),
    loadForVote: jest.fn(),
    castVote: jest.fn(),
    applyVoteClose: jest.fn(),
    notifier,
  });

  test('asks for deadlines in the next hour and reminds each Pick', async () => {
    const sweep: SweepStore = {
      expiredPage: jest.fn().mockResolvedValue([]),
      reminderTargets: jest.fn().mockResolvedValue([
        { pickId: 'p1', userIds: ['a', 'b'] },
        { pickId: 'p2', userIds: ['c'] },
      ]),
    };
    const cs = closingStore();
    const result = await sweepDeadlines(sweep, cs, now);
    expect(sweep.reminderTargets).toHaveBeenCalledWith(
      '2026-10-30T12:00:00.000Z',
      '2026-10-30T13:00:00.000Z',
    );
    expect(cs.notifier).toHaveBeenCalledWith(['a', 'b'], 'reminder', 'p1');
    expect(cs.notifier).toHaveBeenCalledWith(['c'], 'reminder', 'p2');
    expect(result).toMatchObject({ status: 'ok', reminders: { picks: 2, queryFailed: false } });
  });

  test('a failed reminder query is a partial failure, and closes still run', async () => {
    const sweep: SweepStore = {
      expiredPage: jest.fn().mockResolvedValue([]),
      reminderTargets: jest.fn().mockRejectedValue(new Error('down')),
    };
    const result = await sweepDeadlines(sweep, closingStore(), now);
    expect(result.status).toBe('partial_failure');
    expect(sweep.expiredPage).toHaveBeenCalled();
  });

  test('without a notifier or a reminder query the sweep is unchanged', async () => {
    const sweep: SweepStore = { expiredPage: jest.fn().mockResolvedValue([]) };
    const result = await sweepDeadlines(sweep, closingStore(), now);
    expect(result).toMatchObject({ status: 'ok', reminders: { picks: 0 } });
  });
});
