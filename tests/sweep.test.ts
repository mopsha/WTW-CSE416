import * as closing from '@shared/api/closing.ts';
import * as voting from '@shared/api/voting.ts';
import { ApiError } from '@shared/api/errors.ts';
import { authorizeSweep, sweepDeadlines, type SweepStore } from '@shared/api/sweep.ts';

const past = '2026-10-19T11:59:00.000Z';
const now = '2026-10-19T12:00:00.000Z';
const future = '2026-10-19T12:30:00.000Z';
type Pick = closing.ClosingSnapshot & voting.VoteSnapshot;
function pick(id: string, overrides: Partial<Pick> = {}): Pick {
  return {
    id,
    hostId: 'host',
    state: 'swiping',
    center: { lat: 0, lng: 0 },
    closeThreshold: 100,
    deadlineAt: past,
    voteDeadlineAt: null,
    participantIds: ['host'],
    candidates: [{ placeId: 'a', lat: 0, lng: 0 }],
    preferences: [],
    version: '1',
    winnerPlaceId: null,
    finalistIds: [],
    finalists: [{ placeId: 'a', rank: 1 }],
    ballots: [],
    ...overrides,
  };
}

function fixture(picks: Pick[]) {
  const byId = (id: string) => picks.find((p) => p.id === id) ?? null;
  const store = {
    expiredPage: jest.fn(async (phase, cutoff, after) =>
      picks
        .filter((p) => {
          const deadline = phase === 'swiping' ? p.deadlineAt : p.voteDeadlineAt;
          return (
            p.state === phase && deadline !== null && deadline <= cutoff && (!after || p.id > after)
          );
        })
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, 1)
        .map(({ id }) => ({ id })),
    ),
  } satisfies SweepStore;
  const closers = {
    loadForClose: jest.fn(async (id: string) => byId(id)),
    applyClose: jest.fn(async (id, _version, _actor, _user, ranking) => {
      Object.assign(byId(id)!, {
        state: ranking.state,
        winnerPlaceId: ranking.winnerPlaceId,
        voteDeadlineAt: ranking.voteDeadlineAt,
      });
    }),
    loadForVote: jest.fn(async (id: string) => byId(id)),
    castVote: jest.fn(),
    applyVoteClose: jest.fn(async (id, winnerPlaceId) => {
      Object.assign(byId(id)!, { state: 'completed', winnerPlaceId });
    }),
  } satisfies closing.ClosingStore & voting.VotingStore;
  return { store, closers };
}

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date(now));
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test('secret is required, fails closed when unconfigured, and accepts only the configured value', () => {
  for (const value of [undefined, '', 'wrong']) {
    expect(() => authorizeSweep(value, 'test-secret')).toThrow(
      expect.objectContaining({ status: 401 }),
    );
  }
  for (const expected of [undefined, '']) {
    expect(() => authorizeSweep('test-secret', expected)).toThrow(
      expect.objectContaining({ status: 503 }),
    );
  }
  expect(() => authorizeSweep('test-secret', 'test-secret')).not.toThrow();
});

test('routes only expired Picks to the canonical closers, including the exact deadline boundary', async () => {
  const closePick = jest.spyOn(closing, 'closePick');
  const closeVote = jest.spyOn(voting, 'closeVoteByDeadline');
  const { store, closers } = fixture([
    pick('a', { deadlineAt: now }),
    pick('b', { state: 'final_vote', voteDeadlineAt: past }),
    pick('c', { deadlineAt: future }),
    pick('d', { state: 'final_vote', voteDeadlineAt: future }),
    pick('e', { deadlineAt: null }),
    pick('f', { state: 'final_vote', voteDeadlineAt: null }),
    pick('g', { state: 'completed' }),
  ]);
  const result = await sweepDeadlines(store, closers);
  expect(closePick).toHaveBeenCalledTimes(1);
  expect(closePick).toHaveBeenCalledWith(closers, 'a', 'system', null);
  expect(closeVote).toHaveBeenCalledTimes(1);
  expect(closeVote).toHaveBeenCalledWith(closers, 'b');
  expect(result).toMatchObject({
    status: 'ok',
    swiping: { attempted: 1, failed: 0 },
    final_vote: { attempted: 1, failed: 0 },
  });
  await sweepDeadlines(store, closers);
  expect(closers.applyClose).toHaveBeenCalledTimes(1);
  expect(closers.applyVoteClose).toHaveBeenCalledTimes(1);
});

test('continues across pages and phases after a Pick fails without exposing its error', async () => {
  const { store, closers } = fixture([
    pick('a'),
    pick('b'),
    pick('c', { state: 'final_vote', voteDeadlineAt: past }),
  ]);
  closers.loadForClose.mockRejectedValueOnce(new Error('private database details'));
  const result = await sweepDeadlines(store, closers);
  expect(result).toMatchObject({
    status: 'partial_failure',
    swiping: { attempted: 2, processed: 1, failed: 1 },
    final_vote: { processed: 1 },
  });
  expect(JSON.stringify(result)).not.toContain('private');
  expect(closers.applyClose).toHaveBeenNthCalledWith(
    1,
    'b',
    '1',
    'system',
    null,
    expect.any(Object),
  );
  expect(closers.applyVoteClose).toHaveBeenNthCalledWith(1, 'c', 'a', 'vote');
  await sweepDeadlines(store, closers);
  expect(closers.applyClose).toHaveBeenNthCalledWith(
    2,
    'a',
    '1',
    'system',
    null,
    expect.any(Object),
  );
});

test('a failed phase query still allows the other phase to run', async () => {
  const { store, closers } = fixture([pick('v', { state: 'final_vote', voteDeadlineAt: past })]);
  store.expiredPage.mockRejectedValueOnce(new Error('unavailable'));
  expect(await sweepDeadlines(store, closers)).toMatchObject({
    status: 'partial_failure',
    swiping: { queryFailed: true },
    final_vote: { processed: 1 },
  });
});

test('stale selection is safely rechecked by the canonical functions', async () => {
  const { store, closers } = fixture([
    pick('a', { deadlineAt: future }),
    pick('b', { state: 'completed' }),
    pick('c', { state: 'final_vote', voteDeadlineAt: future }),
    pick('d', { state: 'completed', voteDeadlineAt: past }),
  ]);
  store.expiredPage.mockImplementation(async (phase, _cutoff, after) =>
    after ? [] : phase === 'swiping' ? [{ id: 'a' }, { id: 'b' }] : [{ id: 'c' }, { id: 'd' }],
  );
  await sweepDeadlines(store, closers);
  await sweepDeadlines(store, closers);
  expect(closers.applyClose).not.toHaveBeenCalled();
  expect(closers.applyVoteClose).not.toHaveBeenCalled();
});

test('a close race uses the canonical retry and does not block a different Pick', async () => {
  const { store, closers } = fixture([pick('a'), pick('b')]);
  closers.applyClose.mockRejectedValueOnce(new ApiError(409, 'PICK_CONFLICT', 'changed'));
  expect((await sweepDeadlines(store, closers)).status).toBe('ok');
  expect(closers.applyClose.mock.calls.map(([id]) => id)).toEqual(['a', 'a', 'b']);
});
